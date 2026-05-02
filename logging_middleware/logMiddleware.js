const BACKEND_ONLY = new Set([
  "cache",
  "controller",
  "cron_job",
  "db",
  "domain",
  "handler",
  "repository",
  "route",
  "service",
]);

const FRONTEND_ONLY = new Set(["api", "component", "hook", "page", "state", "style"]);

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid log payload");
  }

  const { stack, level, package: packageName, message } = payload;

  if (!["backend", "frontend"].includes(stack)) {
    throw new Error("Invalid stack");
  }

  if (!["debug", "info", "warn", "error", "fatal"].includes(level)) {
    throw new Error("Invalid level");
  }

  if (typeof packageName !== "string" || packageName.trim() === "") {
    throw new Error("Invalid package");
  }

  if (stack === "frontend" && BACKEND_ONLY.has(packageName)) {
    throw new Error(`Package ${packageName} is backend-only`);
  }

  if (stack === "backend" && FRONTEND_ONLY.has(packageName)) {
    throw new Error(`Package ${packageName} is frontend-only`);
  }

  if (typeof message !== "string" || message.trim() === "") {
    throw new Error("Log message must not be empty");
  }
}

function toBearer(token) {
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

function createLogger({ endpoint, tokenProvider } = {}) {
  if (!endpoint) {
    throw new Error("Logging middleware requires endpoint");
  }

  return {
    async Log(stack, level, packageName, message) {
      const payload = {
        stack,
        level,
        package: packageName,
        message,
      };

      try {
        validatePayload(payload);
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: error.message,
        };
      }

      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const token = tokenProvider ? tokenProvider() : "";
      if (token && token.trim()) {
        headers.Authorization = toBearer(token.trim());
      }

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        let data;
        const text = await response.text();
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }

        if (!response.ok) {
          return {
            ok: false,
            status: response.status,
            error: `Log API failed with status ${response.status}`,
            data,
          };
        }

        return {
          ok: true,
          status: response.status,
          data,
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : "Log request failed",
        };
      }
    },
  };
}

module.exports = {
  createLogger,
};
