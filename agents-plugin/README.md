# agents-plugin

The AI agents of LINEA as a plugin: pages under **Agents**, the proxy that lets those pages call the agents' service as the signed-in person, and the socket relay.

- Needs the GitLab git host (`requires.gitHosts: ["gitlab"]` in `plugin.json`): with no GitLab on, the plugin is off and hidden.
- `service/` is **not in this repository**: it is the `linea/linea-agents` service, deployed apart (clone it here, or link it, to work on both).
- Settings: `url` (where the service is) and `serviceKey` (the key LINEA and the service share; it is also a key of LINEA's `Authorization: Service`).

It lives in the `plugins/` folder of a LINEA checkout (`linea/plugins/`; see its README for the plugin interface).
