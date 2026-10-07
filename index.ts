import { App, redirect } from "@elements/app";
import config from "#config";
import signin from "#app/pages/signin";
import requests from "#app/pages/requests";
import request from "#app/pages/request";
import requestForm from "#app/pages/request-form";
import serveQuote from "#app/routes/quote";
import finance from "#app/pages/finance";
import exportCsv from "#app/routes/export";
import departments from "#app/pages/departments";
import notFound from "#app/pages/errors/not-found";
import unhandled from "#app/pages/errors/unhandled";

const app = new App();

app.route("/", () => redirect("/requests"));
app.route("/signin", signin);
app.route("/requests", requests);
app.route("/requests/new", requestForm);
app.route("/requests/:id", request);
app.route("/requests/:id/edit", requestForm);
app.route("/requests/:id/quote", serveQuote);
app.route("/finance", finance);
app.route("/finance/export.csv", exportCsv);
app.route("/departments", departments);

app.error((req, res, err) => {
  switch (err.statusCode) {
    case 401:
      return redirect("/signin");

    case 404:
      return notFound(req, res, err);

    default:
      return unhandled(req, res, err);
  }
});

app.start(config);
