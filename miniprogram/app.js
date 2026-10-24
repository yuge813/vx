const client = require("./services/client");
App({
  onLaunch(options) {
    this.pendingInvite =
      (options && options.query && options.query.invite) || "";
  },
  ready() {
    if (!this._ready)
      this._ready = client.initialize().catch((e) => {
        this._ready = null;
        throw e;
      });
    return this._ready.then(async (config) => {
      if (this.pendingInvite) {
        const code = this.pendingInvite;
        this.pendingInvite = "";
        try {
          await client.request("/api/referral/bind", "POST", {
            code: String(code).toUpperCase(),
          });
        } catch (e) {
          client.toast(e);
        }
      }
      return config;
    });
  },
});
