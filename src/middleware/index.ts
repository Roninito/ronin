// Core middleware re-exported from @ronin/sar
export * from "@ronin/sar/middleware";

// Ronin-specific: ontology resolution (depends on internal resolveOntology)
export { createOntologyResolveMiddleware } from "./ontologyResolve.js";
export type { OntologyResolveOptions } from "./ontologyResolve.js";

// Ronin-specific: artifact detection/injection (depends on src/artifacts)
export { createArtifactInjectMiddleware } from "./artifactInject.js";
export type { ArtifactInjectOptions } from "./artifactInject.js";
