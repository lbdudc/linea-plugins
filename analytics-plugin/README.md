# analytics-plugin

The analysis of the feature model with flamapy: the figures strip and the analysis panel of the model editor, with a Python service (`service/`) that runs in a container of its own.

- Settings: `url` of the service (`FLAMAPY_API_URL`).
- Its own words (`client/messages.js`); it only uses the app's shared vocabulary listed in LINEA's boundary test.

It lives in the `plugins/` folder of a LINEA checkout (see its README for the plugin interface).
