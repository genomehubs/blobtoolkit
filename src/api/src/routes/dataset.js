const Dataset = require("../models/dataset");
const utils = require("../shared/functions/utils");

const getDatasetById = async (req, res) => {
  res.setHeader("content-type", "application/json");
  let dataset = new Dataset(req.params.dataset_id);
  let meta = {};
  try {
    meta = await dataset.loadMeta();
  } catch (message) {
    logError({ req, message });
  }
  if (meta.hasOwnProperty("id")) {
    res.json(meta);
  } else {
    res.sendStatus(404);
  }
};

const getDatasetByIdKey = async (req, res) => {
  res.setHeader("content-type", "application/json");
  let dataset = new Dataset(req.params.dataset_id);
  let meta = await dataset.loadMeta();
  if (meta.hasOwnProperty(req.params.key)) {
    res.json(meta[req.params.key]);
  } else {
    try {
      let result = utils.nestedEntryByKeyValue(
        meta.fields,
        "_id",
        req.params.key,
        ["_data", "_children"]
      )[0];
      if (result) {
        res.json(result);
      } else {
        res.sendStatus(404);
      }
    } catch (err) {
      res.sendStatus(404);
    }
  }
};

const getDatasetByIdKeySubkey = async (req, res) => {
  res.setHeader("content-type", "application/json");
  let { dataset_id, key, subkey } = req.params;
  let dataset = new Dataset(dataset_id);
  let meta = await dataset.loadMeta();
  let json;
  if (meta.hasOwnProperty(key)) {
    json = meta[key];
  } else {
    try {
      let result = utils.nestedEntryByKeyValue(
        meta.fields,
        "_id",
        req.params.key,
        ["_data", "_children"]
      )[0];
      if (result) {
        json = result;
      } else {
        res.sendStatus(404);
      }
    } catch (err) {
      res.sendStatus(404);
    }
  }
  if (json && json.hasOwnProperty(subkey)) {
    res.json(json[subkey]);
  } else {
    if (!json) {
      console.log("json is empty", { dataset_id, key, subkey });
    }
    res.sendStatus(404);
  }
};

module.exports = {
  getDatasetById,
  getDatasetByIdKey,
  getDatasetByIdKeySubkey,
};
