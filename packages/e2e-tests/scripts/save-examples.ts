#!/usr/bin/env ts-node

// NOTE: Set `export API_KEY=someApiKeyHere` before running these steps
// Use the API key for the "Frontend E2E Test Team" that we have set up in admin,
// as that should let us mark these recordings as public.

import { Page } from "@playwright/test";
const playwright = require("@recordreplay/playwright");
import { uploadRecording, listAllRecordings } from "@replayio/replay";
import axios from "axios";
import chalk from "chalk";
import { dots } from "cli-spinners";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import logUpdate from "log-update";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import yargs from "yargs";

import config from "../config";
import { recordNodeExample } from "./record-node";
import { recordPlaywright, uploadLastRecording } from "./record-playwright";

type Target = "all" | "browser" | "node";

// TODO [FE-626] Support target "cra"
const argv = yargs
  .option("example", {
    alias: "e",
    description: "Only re-generate tests for this specific example file",
    type: "string",
  })
  .option("target", {
    alias: "t",
    default: "all",
    description: "Only re-generate tests for this target",
    choices: ["all", "browser", "node"],
  })
  .help()
  .alias("help", "h")
  .parseSync();

const exampleFilename = argv.example || null;
const target: Target = argv.target as Target;

const examplesJsonPath = join(__dirname, "..", "examples.json");

async function getExampleFileNames(path: string, fileExtension: string): Promise<string[]> {
  return readdirSync(path).filter(file => {
    return file.endsWith(fileExtension);
  });
}

function logAnimated(text: string): () => void {
  let index = 0;

  const update = () => {
    const frame = dots.frames[++index % dots.frames.length];
    logUpdate(`${chalk.yellowBright(frame)} ${text}`);
  };

  const intervalId = setInterval(update, dots.interval);

  return () => {
    clearInterval(intervalId);
    logUpdate(`${chalk.greenBright("✓")} ${text}`);
    logUpdate.done();
  };
}

async function saveRecording(example: string, recordingId?: string) {
  if (recordingId) {
  } else {
    const recordings = listAllRecordings();
    if (recordings.length > 0) {
      const lastRecording = recordings[recordings.length - 1];
      recordingId = lastRecording.id;
    } else {
      throw "No recording id found";
    }
  }

  const done = logAnimated(`Saving ${chalk.bold(example)} with recording id ${recordingId}`);

  const id = await uploadRecording(recordingId, {
    apiKey: config.replayApiKey,
  });

  await makeReplayPublic(config.replayApiKey, recordingId);

  const text = "" + readFileSync(examplesJsonPath);
  const json = JSON.parse(text);
  writeFileSync(examplesJsonPath, JSON.stringify({ ...json, [example]: id }, null, 2));

  done();
}

async function saveExamples(
  examplesTarget: Target,
  examplesBasePath: string,
  examplesFileExtension: string,
  callback: (options: { exampleFilename: string; examplePath: string }) => Promise<void>
) {
  switch (target) {
    case "all":
    case examplesTarget:
      const exampleFilenames =
        exampleFilename !== null
          ? [exampleFilename]
          : await getExampleFileNames(examplesBasePath, examplesFileExtension);

      for (let exampleFilename of exampleFilenames) {
        exampleFilename = exampleFilename.endsWith(examplesFileExtension)
          ? exampleFilename
          : `${exampleFilename}${examplesFileExtension}`;

        const examplePath = join(examplesBasePath, exampleFilename);
        if (existsSync(examplePath)) {
          await callback({ exampleFilename, examplePath });
        } else if (target === examplesTarget) {
          // Only error if this was a specific target + example combination.
          // Otherwise assume this is a different type of target.
          throw `Could not find example ${chalk.bold(exampleFilename)}:\n  ${chalk.dim(
            examplePath
          )}`;
        }
      }
      break;
  }
}

async function saveBrowserExamples() {
  await saveExamples(
    "browser",
    config.browserExamplesPath,
    ".html",
    async ({ exampleFilename }) => {
      const done = logAnimated(`Recording example ${chalk.bold(exampleFilename)}`);

      const exampleUrl = `${config.devtoolsUrl}/test/examples/${exampleFilename}`;

      await recordPlaywright(config.browserName, async page => {
        await page.goto(exampleUrl);
        await waitUntilMessage(page as Page, "ExampleFinished");
      });

      done();

      const recordingId = await uploadLastRecording(exampleUrl);
      if (config.useExampleFile && recordingId) {
        await saveRecording(exampleFilename, recordingId);
      }
    }
  );
}

async function saveNodeExamples() {
  await saveExamples(
    "node",
    config.nodeExamplesPath,
    ".js",
    async ({ exampleFilename, examplePath }) => {
      const done = logAnimated(`Recording example ${chalk.bold(exampleFilename)}`);

      process.env.RECORD_REPLAY_METADATA_TEST_RUN_ID = uuidv4();

      const recordingId = await recordNodeExample(examplePath);
      if (recordingId) {
        await saveRecording(`node/${exampleFilename}`, recordingId!);

        done();

        console.log(
          `Saved recording ${chalk.bold(exampleFilename)} with id ${chalk.bold(recordingId)}`
        );
      } else {
        done();

        throw `Unable to save recording for ${chalk.bold(exampleFilename)}`;
      }
    }
  );
}

async function makeReplayPublic(apiKey: string, recordingId: string) {
  const variables = {
    recordingId: recordingId,
    isPrivate: false,
  };

  return axios({
    url: "https://api.replay.io/v1/graphql",
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    data: {
      query: `
        mutation MakeReplayPublic($recordingId: ID!, $isPrivate: Boolean!) {
          updateRecordingPrivacy(input: { id: $recordingId, private: $isPrivate }) {
            success
          }
        }
      `,
      variables,
    },
  }).catch(e => {
    if (e.response) {
      console.log("Parameters");
      console.log(JSON.stringify(variables, undefined, 2));
      console.log("Response");
      console.log(JSON.stringify(e.response.data, undefined, 2));
    }

    throw e.message;
  });
}

async function waitUntilMessage(page: Page, message: string, timeout: number = 30_000) {
  return await new Promise((resolve, reject) => {
    let timer = setTimeout(reject, timeout);
    page.on("console", async msg => {
      try {
        const firstArg = await msg.args()[0]?.jsonValue();
        // console.log(firstArg);
        if (firstArg === message) {
          const secondArg = await msg.args()[1]?.jsonValue();
          clearTimeout(timer);
          resolve(secondArg);
        }
      } catch (e) {
        console.log("Unserializable value");
      }
    });
  });
}

(async () => {
  try {
    await saveBrowserExamples();
    await saveNodeExamples();

    process.exit(0);
  } catch (error) {
    console.error(error);

    process.exit(1);
  }
})();
