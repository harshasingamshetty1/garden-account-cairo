import fs from "fs";

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
