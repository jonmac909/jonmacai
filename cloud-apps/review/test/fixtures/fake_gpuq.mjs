// Stands in for `gpuq.py run --model parakeet -- <python> -I <parakeet_transcribe.py> <audio> <out.json>` in the tests:
// refuses anything that is not a parakeet turn, then writes Parakeet's JSON shape.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] !== "run" || args[args.indexOf("--model") + 1] !== "parakeet" || !args.includes("--")) process.exit(3);
const [audio, out] = args.slice(-2);
writeFileSync(out, JSON.stringify({ text: ` heard ${readFileSync(audio).length} bytes `, segments: [] }));
