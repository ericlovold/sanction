type AuthInstance = {
  $context: Promise<unknown>
  api: object
  handler: (request: Request) => Promise<Response>
}

// Better Auth initializes plugins eagerly and retains a rejected context for
// the lifetime of that instance. Start on use, observe initialization failures
// immediately, and let the next request construct a fresh instance. Endpoint
// failures never reset the instance or replay an operation.
export function lazyAuth<T extends AuthInstance>(create: () => T): T {
  let instance: T | undefined
  function current(): T {
    if (!instance) {
      const created = create()
      instance = created
      void created.$context.catch(() => {
        if (instance === created) instance = undefined
      })
    }
    return instance
  }

  const methods = new Map<PropertyKey, (...args: unknown[]) => Promise<unknown>>()
  const api = new Proxy({}, {
    get(_target, key) {
      // An API namespace is not a promise; promise assimilation must not
      // manufacture an endpoint named "then" or initialize authentication.
      if (key === "then") return undefined
      if (methods.has(key)) return methods.get(key)
      const invoke = async (...args: unknown[]) => {
        const auth = current()
        await auth.$context
        const method = Reflect.get(auth.api, key) as (...args: unknown[]) => unknown
        return Reflect.apply(method, auth.api, args)
      }
      // Better Auth attaches endpoint metadata (path/options) to API methods.
      const method = new Proxy(invoke, {
        get(_target, property) {
          return Reflect.get(Reflect.get(current().api, key), property)
        },
      })
      methods.set(key, method)
      return method
    },
  })
  const handler = async (request: Request) => {
    const auth = current()
    await auth.$context
    return auth.handler(request)
  }
  return new Proxy({ api, handler, fetch: handler }, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key)
      return Reflect.get(current(), key)
    },
  }) as unknown as T
}
