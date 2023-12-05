const Application = require("./core");
const app = new Application();
app.start(app.$config.port || 4044);
