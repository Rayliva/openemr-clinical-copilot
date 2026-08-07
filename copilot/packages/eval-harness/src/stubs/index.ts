/**
 * Public surface of the T3 stub-engine subdir. The orchestrator wires this into the package barrel
 * (`src/index.ts`) at integration — Wave-1 builders do not edit that barrel themselves.
 */
export { createStubEngine, type StubEngineOptions } from "./stubEngine.js";
