import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "gmail",
  name: "Gmail",
  description: "Gmail channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./src/channel.js",
    exportName: "gmailPlugin",
  },
  runtime: {
    specifier: "./src/runtime.js",
    exportName: "setGmailRuntime",
  },
});
