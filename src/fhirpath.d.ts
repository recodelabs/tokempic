declare module 'fhirpath' {
  const fhirpath: {
    evaluate(resource: unknown, path: string, context?: unknown, model?: unknown): unknown[];
  };
  export default fhirpath;
}
