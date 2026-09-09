import { cli } from "./cli.js";

void main();

async function main(): Promise<void> {
  try {
    const code = await cli(process.argv.slice(2));
    process.exitCode = code;
  } catch (error) {
    process.stderr.write(`\n✘ ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("run: myagent help\n");
    process.exitCode = 1;
  }
}