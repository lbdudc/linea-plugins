try {
  const status = rs.status();
  if (status.ok === 1) {
    print("Replica set ya inicializado, no hago nada.");
  } else {
    print("Estado raro de replica set, status.ok != 1");
    printjson(status);
  }
} catch (e) {
  if (e.codeName === "NotYetInitialized" || (e.message || "").includes("not yet initialized")) {
    print("Replica set NO inicializado. Lanzando rs.initiate()...");
    rs.initiate({
      _id: "rs0",
      members: [{ _id: 0, host: "mongo:27017" }]
    });
    print("rs.initiate() lanzado.");
  } else {
    print("Error inesperado al consultar rs.status():");
    printjson(e);
    quit(1);
  }
}