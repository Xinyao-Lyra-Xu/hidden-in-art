// The embedding port the agent's RAG depends on.
//
// Like LlmCaller, this is a boundary: the domain only knows it can turn texts
// into vectors, never how. Infrastructure supplies a provider-backed
// implementation; tests and the offline corpus inject a scripted one. Batching
// is part of the contract — callers pass many texts and get one vector each, in
// order — so the corpus can be embedded in a single round-trip.

export type Embedder = (texts: string[]) => Promise<number[][]>;
