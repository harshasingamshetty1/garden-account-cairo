import fs from "fs";
import path from "path";

import { config } from "../config";

const ASCII_ENCODING: BufferEncoding = "ascii";
const JSON_SPACES = 2;

export function readJsonFile<T>(location: string): T {
  const rawData = fs.readFileSync(location, { encoding: ASCII_ENCODING });
  return JSON.parse(rawData);
}

export function writeJsonFile(location: string, payload: unknown) {
  fs.writeFileSync(location, JSON.stringify(payload, null, JSON_SPACES), {
    encoding: ASCII_ENCODING,
  });
}

export function resolveArtifactPath(name: string) {
  if (!config.artifactDir) {
    throw new Error("Missing artifactDir in config");
  }
  return path.join(config.artifactDir, name);
}
