import React from 'react';

import "./CustomSchemaResult.css";

import { FormGroup, HTMLSelect } from "@blueprintjs/core";
import { store, view } from "@risingstack/react-easy-state";

import { persistentLruStore } from "../../../carrotsearch/store/persistent-store.js";
import { TitleAndRank } from "../results/Result.js";

import { resultListConfigStore } from "../results/ResultListConfig.js";

import { ResultWrapper } from "../results/ResultList.js";
import { mapUpToMaxLength, wrapIfNotArray } from "../../../carrotsearch/lang/arrays.js";
import { displayNoneIf } from "../../apps/search-app/ui/Optional.js";
import { isEmpty } from "../../../carrotsearch/lang/objects.js";

export const createResultConfigStore = (key) => {
  const keyFromFields = fields => fields.join("--");

  const fieldConfigStore = store({
    fieldRoles: {},
    resultForPreview: undefined,
    isEmpty: () => Object.keys(fieldConfigStore.fieldRoles).length === 0,
    load: (fieldStats, result) => {
      if (fieldStats.length === 0) {
        return;
      }

      // Guess initial field display mappings based on field statistics.
      let map = resultConfigs.get(keyFromFields(fieldStats.map(f => f.field)));
      if (!map) {
        map = fieldStats.reduce((map, field) => {
          if (field.tagScore > 1 && field.tagScore > field.propScore) {
            map[field.field] = "tag";
          } else if (field.propScore > 1 && field.propScore > field.tagScore && field.distinct
              > 1) {
            map[field.field] = "property";
          } else if (field.naturalTextScore > 2) {
            map[field.field] = "body";
          } else {
            map[field.field] = "not shown";
          }
          return map;
        }, {});

        const byIdScore = fieldStats.sort((a, b) => b.idScore - a.idScore);
        if (byIdScore[0].idScore >= 2) {
          map[byIdScore[0].field] = "id";
        }
        const byTitle = fieldStats.sort((a, b) => b.titleScore - a.titleScore);
        if (byTitle[0].titleScore >= 2) {
          map[byTitle[0].field] = "title";
        }
      }
      fieldConfigStore.fieldRoles = map;

      // Choose the document with all fields available for preview
      fieldConfigStore.resultForPreview = result.documents.find(d => {
        return Object.keys(d).reduce((hasField, field) => {
          return hasField && !isEmpty(d[field]);
        }, true) || result.documents[0];
      });
    }
  });

  const resultConfigs = persistentLruStore(
      `workbench:source:${key}:resultConfigs`,
      item => keyFromFields(Object.keys(item)),
      () => fieldConfigStore.fieldRoles
  );

  return fieldConfigStore;
};

const FIELD_ROLES = [
  "not shown", "title", "body", "tag", "property", "id"
];
const FieldRole = view(({ field, configStore }) => {
  return (
      <FormGroup label={<><span>{field}</span><small>show as</small></>} inline={true}>
        <HTMLSelect value={configStore.fieldRoles[field]}
                    onChange={e => configStore.fieldRoles[field] = e.currentTarget.value}>
          {
            FIELD_ROLES.map(role => <option key={role} value={role}>{role}</option>)
          }
        </HTMLSelect>
      </FormGroup>
  );
});

const FieldRoles = ({ configStore }) => {
  return (
      <div className="FieldRoles">
        {
          Object.keys(configStore.fieldRoles).map(f => {
            return <FieldRole key={f} field={f} configStore={configStore} />;
          })
        }
      </div>
  );
};

export const ResultPreview = view(({ configStore }) => {
  const result = configStore.resultForPreview;
  const preview = result ?
      <ResultWrapper document={result}>
        <CustomSchemaResult document={result} rank={1} configStore={configStore} />
      </ResultWrapper>
      : <span>Not available</span>;

  return (
      <div>
        <p>Preview:</p>
        <div className="ResultPreview">
          {preview}
        </div>
      </div>
  )
});

export const CustomSchemaResultConfig = view(({ configStore, previewResultProvider }) => {
  return (
      <div className="CustomSchemeResultConfig" style={displayNoneIf(configStore.isEmpty())}>
        <div>
          <p>Choose the fields to show:</p>
          <FieldRoles configStore={configStore} />
        </div>
        <ResultPreview configStore={configStore} />
      </div>
  );
});

export const CustomSchemaResult = view(({ document, rank, configStore }) => {
  const rolesMap = configStore.fieldRoles;
  const roles = Object.keys(rolesMap).reduce((groups, field) => {
    const role = rolesMap[field];
    if (role !== "not shown") {
      groups[role].push(field);
    }
    return groups;
  }, { "title": [], "body": [], "tag": [], "property": [], "id": [] });

  const bodyParagraphs = roles["body"].reduce((arr, field) => {
    const value = document[field];
    if (value) {
      const val = wrapIfNotArray(value);
      val.forEach((v, index) => {
        if (index === 0) {
          arr.push({ text: v, field: field });
        } else {
          arr.push({ text: v });
        }
      });
    }
    return arr;
  }, []);

  const allProperties = roles["property"].reduce((arr, field) => {
    const val = wrapIfNotArray(document[field]);
    arr.push({ field: field, text: val.join(", ") })
    return arr;
  }, []);

  return (
      <>
        {
          roles["title"].map((field, index) => {
            return <TitleAndRank key={field} title={wrapIfNotArray(document[field]).join(", ")} rank={rank}
                                 showRank={index === 0 && resultListConfigStore.showRank} />
          })
        }

        <div>
          {
            mapUpToMaxLength(
                bodyParagraphs,
                resultListConfigStore.maxCharsPerResult,
                (text, obj, index) => {
                  const label = obj.field ? <span>{obj.field}</span> : null;
                  return <p key={index}>{label}{text}</p>;
                },
                obj => obj.text)
          }
        </div>

        {
          [...roles["id"], ...roles["tag"]].map(field => {
            const tags = wrapIfNotArray(document[field]);
            return (
                <div className="tags" key={field}>
                  <span>{field}</span>
                  {
                    tags.join(", ")
                  }
                </div>
            );
          })
        }

        <dl className="properties">
          {
            allProperties.map(p => {
              return (
                  <React.Fragment key={p.field}>
                    <dt>{p.field}</dt>
                    <dd>{p.text}</dd>
                    {" "}
                  </React.Fragment>
              )
            })
          }
        </dl>
      </>
  );
});