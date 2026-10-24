const client = require("./services/client");
App({
  ready() {
    if (!this._ready)
      this._ready = client.initialize().catch((error) => {
        this._ready = null;
        throw error;
      });
    return this._ready;
  },
});
