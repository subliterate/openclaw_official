import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setMessengerRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getMessengerRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Messenger runtime not initialized");
  }
  return runtime;
}
