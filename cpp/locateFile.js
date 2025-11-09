// Allow user to override locateFile, otherwise use scriptDirectory
if (!Module["locateFile"]) {
  Module["locateFile"] = (path, scriptDirectory) => {
    return scriptDirectory + path;
  };
}
