(function installAiosBasePath() {
  const basePath = "/yt";
  const nativeFetch = window.fetch.bind(window);

  function withBasePath(pathname) {
    if (!pathname || pathname === "/") return basePath;
    if (pathname === basePath || pathname.startsWith(`${basePath}/`)) return pathname;
    return `${basePath}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }

  function rewriteInput(input) {
    if (typeof input === "string") {
      return input.startsWith("/") ? withBasePath(input) : input;
    }
    if (input instanceof URL) {
      if (input.origin !== window.location.origin) return input;
      const rewritten = new URL(input);
      rewritten.pathname = withBasePath(rewritten.pathname);
      return rewritten;
    }
    if (input instanceof Request) {
      const url = new URL(input.url);
      if (url.origin !== window.location.origin) return input;
      url.pathname = withBasePath(url.pathname);
      return new Request(url, input);
    }
    return input;
  }

  window.__AIOS_BASE_PATH__ = basePath;
  window.__AIOS_PATH__ = withBasePath;
  window.fetch = (input, init) => nativeFetch(rewriteInput(input), init);
})();
