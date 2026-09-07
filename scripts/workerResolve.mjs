const sourceRoot = new URL('../src/', import.meta.url);

// This loader is only installed by the standalone server processes.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { url: 'data:text/javascript,export {};', shortCircuit: true };
  }
  const target = specifier.startsWith('@/')
    ? new URL(specifier.slice(2), sourceRoot).href
    : specifier;
  try {
    return await nextResolve(target, context);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND'
      && (target.startsWith('file:') || target.startsWith('./') || target.startsWith('../'))
      && !/\.[a-z]+$/i.test(target)) {
      return nextResolve(`${target}.ts`, context);
    }
    throw error;
  }
}
