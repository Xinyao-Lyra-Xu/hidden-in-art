// Registers the resolve hook in a worker thread so `node --import` can pick it
// up before any test module loads. Usage:
//   node --import ./tests/register.mjs --test tests
import { register } from "node:module";

register("./resolve-hook.mjs", import.meta.url);
