const path = require("path");

module.exports = {
  name: "gemini-omnibar",
  entry: "./packages/omnibar-wc/src/index.ts",
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: "ts-loader",
          options: { configFile: "tsconfig.build.json" }
        },
        exclude: [/node_modules/, /\.test\.ts$/, /\.spec\.ts$/]
      }
    ]
  },
  resolve: {
    extensions: [".ts", ".js"]
  },
  output: {
    filename: "gemini-omnibar.js",
    path: path.resolve(__dirname, "packages/omnibar-wc/dist"),
    library: {
      name: "GeminiOmnibar",
      type: "umd"
    },
    globalObject: "typeof globalThis !== 'undefined' ? globalThis : window"
  },
  devtool: "source-map"
};
