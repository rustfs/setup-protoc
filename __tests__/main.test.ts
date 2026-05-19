import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import nock from "nock";

const toolDir = path.join(__dirname, "runner", "tools");
const tempDir = path.join(__dirname, "runner", "temp");
const dataDir = path.join(__dirname, "testdata");
const IS_WINDOWS = process.platform === "win32";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

process.env.RUNNER_TEMP = tempDir;
process.env.RUNNER_TOOL_CACHE = toolDir;
import * as installer from "../src/installer";

function mockReleasePages() {
  for (let pageNum = 1; pageNum <= 6; pageNum++) {
    nock("https://api.github.com")
      .get(`/repos/protocolbuffers/protobuf/releases?page=${pageNum}`)
      .replyWithFile(200, path.join(dataDir, `releases-${pageNum}.json`));
  }
}

describe("filename tests", () => {
  const tests = [
    ["protoc-23.2-linux-x86_32.zip", "linux", ""],
    ["protoc-23.2-linux-x86_64.zip", "linux", "x64"],
    ["protoc-23.2-linux-aarch_64.zip", "linux", "arm64"],
    ["protoc-23.2-linux-ppcle_64.zip", "linux", "ppc64"],
    ["protoc-23.2-linux-s390_64.zip", "linux", "s390x"],
    ["protoc-23.2-osx-aarch_64.zip", "darwin", "arm64"],
    ["protoc-23.2-osx-x86_64.zip", "darwin", "x64"],
    ["protoc-23.2-win64.zip", "win32", "x64"],
    ["protoc-23.2-win64.zip", "win32", "arm64"],
    ["protoc-23.2-win32.zip", "win32", "x32"],
  ];
  it(`Downloads all expected versions correctly`, () => {
    for (const [expected, plat, arch] of tests) {
      const actual = installer.getFileName("23.2", plat, arch);
      expect(expected).toBe(actual);
    }
  });
});

describe("archive extraction tests", () => {
  it("Adds zip extension for Windows extraction", () => {
    expect(installer.zipPathForExtraction("C:\\temp\\archive", "win32")).toBe(
      "C:\\temp\\archive.zip",
    );
  });

  it("Leaves existing zip path unchanged", () => {
    expect(
      installer.zipPathForExtraction("C:\\temp\\archive.zip", "win32"),
    ).toBe("C:\\temp\\archive.zip");
  });

  it("Leaves non-Windows path unchanged", () => {
    expect(installer.zipPathForExtraction("/tmp/archive", "linux")).toBe(
      "/tmp/archive",
    );
  });
});

describe("version resolver tests", () => {
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("Uses exact three-part versions without querying releases", async () => {
    nock.disableNetConnect();

    await expect(installer.computeVersion("v3.20.3", false, "")).resolves.toBe(
      "v3.20.3",
    );
  });

  it("Resolves latest stable version", async () => {
    mockReleasePages();

    await expect(installer.computeVersion("latest", false, "")).resolves.toBe(
      "v23.1",
    );
  });

  it("Resolves legacy patch versions from prefix", async () => {
    mockReleasePages();

    await expect(installer.computeVersion("v3.20", false, "")).resolves.toBe(
      "v3.20.3",
    );
  });

  it("Retries anonymously when the token is rejected", async () => {
    nock("https://api.github.com", {
      reqheaders: {
        authorization: "Bearer bad-token",
      },
    })
      .get("/repos/protocolbuffers/protobuf/releases?page=1")
      .reply(401, { message: "Bad credentials" });
    mockReleasePages();

    await expect(
      installer.computeVersion("latest", false, "bad-token"),
    ).resolves.toBe("v23.1");
  });
});

describe("installer tests", () => {
  beforeEach(async function () {
    await fs.promises.rm(toolDir, { force: true, recursive: true });
    await fs.promises.rm(tempDir, { force: true, recursive: true });
    await fs.promises.mkdir(toolDir, { recursive: true });
    await fs.promises.mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.promises.rm(toolDir, { force: true, recursive: true });
      await fs.promises.rm(tempDir, { force: true, recursive: true });
    } catch {
      console.log("Failed to remove test directories");
    }
  });

  it("Downloads version of protoc if no matching version is installed", async () => {
    await installer.getProtoc("v23.0", true, GITHUB_TOKEN);
    const protocDir = path.join(toolDir, "protoc", "v23.0", os.arch());

    expect(fs.existsSync(`${protocDir}.complete`)).toBe(true);

    if (IS_WINDOWS) {
      expect(fs.existsSync(path.join(protocDir, "bin", "protoc.exe"))).toBe(
        true,
      );
    } else {
      expect(fs.existsSync(path.join(protocDir, "bin", "protoc"))).toBe(true);
    }
  }, 100000);

  describe("Gets the latest release of protoc", () => {
    beforeEach(() => {
      mockReleasePages();
    });

    afterEach(() => {
      nock.cleanAll();
      nock.enableNetConnect();
    });

    const tests = [
      ["v23.1", "v23.1"],
      ["v22.x", "v22.5"],
      ["v23.0-rc2", "v23.0-rc2"],
    ];
    tests.forEach(function (testCase) {
      const [input, expected] = testCase;
      it(`Gets latest version of protoc using ${input} and no matching version is installed`, async () => {
        await installer.getProtoc(input, true, GITHUB_TOKEN);
        const protocDir = path.join(toolDir, "protoc", expected, os.arch());

        expect(fs.existsSync(`${protocDir}.complete`)).toBe(true);
        if (IS_WINDOWS) {
          expect(fs.existsSync(path.join(protocDir, "bin", "protoc.exe"))).toBe(
            true,
          );
        } else {
          expect(fs.existsSync(path.join(protocDir, "bin", "protoc"))).toBe(
            true,
          );
        }
      }, 100000);
    });
  });
});
