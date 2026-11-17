export const createLineExpectedCalls = [
  [
    undefined,
    1656,
    "src/platform/model.uvl",
    "main",
    "features\n\tGEMA\n\t\tmandatory\n\t\t\tvoid"
  ],
  [
    undefined,
    1656,
    "src/platform/config.json",
    "main",
    "{\n  \"ignore\": [\n    \"target\",\n    \"bower_components\",\n    \".gradle\",\n    \".project\",\n    \"bin\",\n    \"build\",\n    \".settings\",\n    \".classpath\"\n  ],\n  \"delimiters\": [\n    {\n      \"extension\": [\n        \"html\",\n        \"jsp\",\n        \"xml\"\n      ],\n      \"start\": \"<!--%\",\n      \"end\": \"%-->\"\n    },\n    {\n      \"extension\": [\n        \"css\",\n        \"js\",\n        \"java\",\n        \"vue\",\n        \"g4\",\n        \"tokens\",\n        \"gradle\",\n        \"md\",\n        \"conf\",\n        \"gitignore\",\n        \"properties\",\n        \"sql\",\n        \"env\",\n        \"production\"\n      ],\n      \"start\": \"/*%\",\n      \"end\": \"%*/\"\n    },\n    {\n      \"extension\": [\n        \"py\"\n      ],\n      \"start\": \"#%\",\n      \"end\": \"%#\"\n    },\n    {\n      \"extension\": [\n        \"json\"\n      ],\n      \"start\": \"###<\",\n      \"end\": \">###\"\n    }\n  ]\n}"
  ],
  [
    undefined,
    1656,
    "src/platform/code/.gitignore",
    "main",
    "node_modules/\ntarget/\ndist/\n.env\n*.log\n"
  ],
  [
    undefined,
    1656,
    "src/platform/extra.js",
    "main",
    "function pluralize(name) {\n  return name + \"s\";\n}\n\nfunction capitalizeOneWord(word) {\n  return word.charAt(0).toUpperCase() + word.slice(1);\n}\n\nfunction camelToSnakeCase(str) {\n  return str[0].toLowerCase() + str.slice(1, str.length).replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());\n}\n\nfunction normalizeKebabCase(str) {\n  return str\n    .replace(/[\\s-]+/g, '-')\n    .replace(/([a-z])([A-Z])/g, '$1_$2')\n    .toLowerCase();\n}\n\nfunction normalizeSnakeCase(str) {\n  return str\n    .replace(/[\\s-]+/g, '_')\n    .replace(/([a-z])([A-Z])/g, '$1_$2')\n    .toLowerCase();\n}\n\nfunction normalizeUrl(str) {\n  return str\n    .normalize(\"NFKD\")\n    .replace(/[\\u0300-\\u036F]/g, \"\")\n    .trim()\n    .replace(/[\\s]/g, \"-\")\n    .toLowerCase();\n}\n\nfunction getDatabaseConfigFromSpec(data, name, defaultValue) {\n  var dataBase = data.basicData.database;\n  if (dataBase) {\n    if (dataBase[name] && dataBase[name] != \"\") {\n      return dataBase[name];\n    }\n  }\n  return defaultValue;\n}\n\nfunction getExtraConfigFromSpec(data, name, defaultValue) {\n  var extra = data.basicData.extra;\n  if (extra) {\n    if (extra[name] && extra[name] != \"\") {\n      return extra[name];\n    }\n  }\n  return defaultValue;\n}\n"
  ],
  [
    undefined,
    1656,
    "src/platform/transformation.js",
    "main",
    "module.exports = modelTransformation;\n\nvar _metamodelProcessors = [];\n\nfunction registerMetamodelProcessor(fn) {\n  _metamodelProcessors.push(fn);\n}\n\nfunction modelTransformation(input) {\n  if (input.data && input.data.basicData) return input;\n\n  let ret = {};\n  ret.features = input.features;\n  ret.data = {};\n  ret.data.basicData = basicData(input.basicData);\n\n  _metamodelProcessors.forEach(function(processor) {\n    processor(ret, input);\n  });\n\n  ret.data.gui = gui(ret.features, input.basicData.name);\n  ret.data.menus = menus(ret);\n  ret.data.statics = statics(input.statics);\n  return ret;\n}\n\nfunction normalize(str, upper) {\n  return str\n    .normalize(\"NFKD\")\n    .replace(/[\\u0300-\\u036F]/g, \"\")\n    .replace(/[-_]+/g, \" \")\n    .replace(/[^\\w\\s]/gi, \"\")\n    .replace(/\\s(.)/g, function ($1) {\n      return $1.toUpperCase();\n    })\n    .replace(/\\s/g, \"\")\n    .replace(/^(.)/, function ($1) {\n      return upper ? $1.toUpperCase() : $1.toLowerCase();\n    });\n}\n\nfunction basicData(input) {\n  return {\n    index: {\n      component: \"STATIC\",\n      view: \"welcome\",\n    },\n    languages: input.languages || [],\n    name: input.name,\n    packageInfo: {\n      artifact: normalize(input.name).toLowerCase(),\n      group: input.packageGroup || \"com.example\",\n    },\n    database: input.database,\n    extra: input.extra,\n    SRID: input.SRID,\n    version: input.version,\n  };\n}\n\nfunction gui(features, name) {\n  const ret = {\n    settings: {\n      font: { family: \"Arial\", size: \"14px\" },\n      colorset: [\"#fff\", \"#eee\", \"#777\", \"#555\", \"#577492\", \"#333\", \"#222\"],\n      header: { type: \"Text\", text: name },\n    },\n  };\n\n  if (features.indexOf(\"GUI_M_Top\") !== -1) {\n    ret.design = \"1\";\n  } else if (features.indexOf(\"GUI_M_Left\") !== -1) {\n    ret.design = \"5\";\n  } else if (features.indexOf(\"GUI_M_Right\") !== -1) {\n    ret.design = \"6\";\n  } else {\n    ret.design = \"4\";\n  }\n  if (features.indexOf(\"GUI_M_Top\") !== -1 && features.indexOf(\"GUI_M_Left\") !== -1) {\n    ret.design = \"2\";\n  }\n  if (features.indexOf(\"GUI_M_Top\") !== -1 && features.indexOf(\"GUI_M_Right\") !== -1) {\n    ret.design = \"3\";\n  }\n\n  return ret;\n}\n\nfunction statics(input) {\n  return input;\n}\n\nfunction menus(product) {\n  const ret = [];\n\n  switch (product.data.gui.design) {\n    case \"1\": ret.push({ id: \"top\", elements: [] }); break;\n    case \"2\": ret.push({ id: \"top\", elements: [] }); ret.push({ id: \"left\", elements: [] }); break;\n    case \"3\": ret.push({ id: \"top\", elements: [] }); ret.push({ id: \"right\", elements: [] }); break;\n    case \"4\": return [];\n    case \"5\": ret.push({ id: \"left\", elements: [] }); break;\n    case \"6\": ret.push({ id: \"right\", elements: [] }); break;\n  }\n\n  if (product.data.lists && product.features.indexOf(\"GUI_Lists\") !== -1) {\n    ret[0].elements.push(listMenu(product.data.lists));\n  }\n  ret[0].elements.push(listComponents(product.features));\n\n  if (product.features.indexOf(\"UserManagement\") !== -1) {\n    ret[0].elements.push(listUserManagement(product.features));\n  }\n\n  return ret;\n}\n\nfunction listMenu(lists) {\n  return {\n    id: \"Lists\",\n    type: \"MENU\",\n    elements: lists.map((l) => ({\n      id: l.id,\n      type: \"VIEW\",\n      view: { component: \"LIST\", view: l.id },\n    })),\n    access: { admin: true, logged: true },\n  };\n}\n\nfunction listComponents(features) {\n  return {\n    id: \"Components\",\n    type: \"MENU\",\n    elements: features\n      .filter((f) => featureMenu(f, features))\n      .map((f) => featureMenu(f, features)),\n    access: { admin: true, logged: true },\n  };\n}\n\nfunction featureMenu(feature, features) {\n  // Add cases for your platform's features here\n  // Example: case \"MY_FEATURE\": return view(\"MY_COMPONENT\", \"My View\");\n  return null;\n}\n\nfunction listUserManagement(features) {\n  const list = [];\n  let aux;\n\n  if (features.indexOf(\"UM_Authentication\") !== -1) {\n    aux = view(\"USER_MANAGEMENT\", \"Sign in\");\n    aux.access = { anonymous: true };\n    list.push(aux);\n  }\n  if (features.indexOf(\"UM_R_Anonymous\") !== -1) {\n    aux = view(\"USER_MANAGEMENT\", \"Registration\");\n    aux.access = { anonymous: true };\n    list.push(aux);\n  }\n  if (features.indexOf(\"UM_UP_ByUser\") !== -1) {\n    aux = view(\"USER_MANAGEMENT\", \"Change password\");\n    aux.access = { admin: true, logged: true };\n    list.push(aux);\n  }\n  if (features.indexOf(\"UM_UserProfile\") !== -1) {\n    aux = view(\"USER_MANAGEMENT\", \"Profile details\");\n    aux.access = { admin: true, logged: true };\n    list.push(aux);\n  }\n  if (features.indexOf(\"UM_UserSessions\") !== -1) {\n    aux = view(\"USER_MANAGEMENT\", \"Sessions\");\n    aux.access = { admin: true, logged: true };\n    list.push(aux);\n  }\n  if (features.indexOf(\"UM_UserCRUD\") !== -1) {\n    aux = view(\"USER_MANAGEMENT\", \"User Management\");\n    aux.access = { admin: true };\n    list.push(aux);\n  }\n  if (features.indexOf(\"UM_Authentication\") !== -1) {\n    aux = view(\"USER_MANAGEMENT\", \"Exit\");\n    aux.access = { admin: true, logged: true };\n    list.push(aux);\n  }\n\n  return { id: \"Account\", type: \"MENU\", elements: list };\n}\n\nfunction view(comp, view) {\n  return {\n    id: view,\n    type: \"VIEW\",\n    view: { component: comp, view: view },\n  };\n}\n"
  ],
  [
    undefined,
    1656,
    "src/platform/code/.gitlab-ci.yml",
    "main",
    "#\n# A pipeline is composed of independent jobs that run scripts, grouped into stages.\n# Stages run in sequential order, but jobs within stages run in parallel.\n#\n# For more information, see: https://docs.gitlab.com/ee/ci/yaml/index.html#stages\n\nstages:\n  - test\n\n# Test commands live in ci/test-server.sh and ci/test-client.sh.\n# Domain engineers edit those scripts to wire in real tests; this YAML should\n# not need changes.\n\ntest_server:\n  stage: test\n  image: gradle:8-jdk21\n  variables:\n    GRADLE_USER_HOME: \"$CI_PROJECT_DIR/.gradle\"\n  script:\n    - sh ./ci/test-server.sh\n  cache:\n    key: gradle-$CI_COMMIT_REF_SLUG\n    paths:\n      - .gradle/caches\n      - .gradle/wrapper\n  artifacts:\n    when: always\n    reports:\n      junit: server/build/test-results/test/**/TEST-*.xml\n    expire_in: 1 week\n  rules:\n    - if: '$CI_PIPELINE_SOURCE == \"merge_request_event\"'\n    - if: '$CI_COMMIT_BRANCH'\n\ntest_client:\n  stage: test\n  image: node:20\n  script:\n    - sh ./ci/test-client.sh\n  cache:\n    key: node-$CI_COMMIT_REF_SLUG\n    paths:\n      - client/node_modules\n  artifacts:\n    when: always\n    reports:\n      junit: client/test-results/**/junit*.xml\n    expire_in: 1 week\n  rules:\n    - if: '$CI_PIPELINE_SOURCE == \"merge_request_event\"'\n    - if: '$CI_COMMIT_BRANCH'\n"
  ],
  [
    undefined,
    1656,
    "src/platform/code/ci/test-server.sh",
    "main",
    "#!/bin/sh\n#\n# Server test command for this product.\n#\n# Default is a no-op (exit 0) so generated products with no tests yield a\n# green pipeline. Replace the echo+exit below with the real test command,\n# e.g.:\n#\n#   cd server && ./gradlew test\n#   cd server && mvn test\n#\n# Any non-zero exit will fail the test_server job in .gitlab-ci.yml.\n\necho \"[test-server] No server tests defined for this product.\"\necho \"[test-server] Edit ci/test-server.sh to wire in real tests.\"\nexit 0\n"
  ],
  [
    undefined,
    1656,
    "src/platform/code/ci/test-client.sh",
    "main",
    "#!/bin/sh\n#\n# Client test command for this product.\n#\n# Default is a no-op (exit 0) so generated products with no tests yield a\n# green pipeline. Replace the echo+exit below with the real test command,\n# e.g.:\n#\n#   cd client && npm ci && npm test\n#   cd client && yarn install --frozen-lockfile && yarn test\n#\n# Any non-zero exit will fail the test_client job in .gitlab-ci.yml.\n\necho \"[test-client] No client tests defined for this product.\"\necho \"[test-client] Edit ci/test-client.sh to wire in real tests.\"\nexit 0\n"
  ],
  [
    undefined,
    1656,
    "products.json",
    "main",
    "{\n  \"productos\": []\n}\n"
  ]
];
