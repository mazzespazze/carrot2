import React from "react";
import PropTypes from "prop-types";

import { view } from "@risingstack/react-easy-state";

import { Section } from "../Section.js";
import { RadioSetting } from "./RadioSetting.js";
import { BooleanSetting } from "./BooleanSetting.js";
import { StringSetting } from "./StringSetting.js";
import { NumericSetting, NumericSettingSimple } from "./NumericSetting.js";
import { SelectSetting } from "./SelectSetting.js";
import { StringArraySetting } from "./StringArraySetting.js";
import { FileSetting } from "./FileSetting.js";
import { ServiceUrlSetting } from "./ServiceUrlSetting.js";
import { persistentStore } from "../../store/persistent-store.js";
import { displayNoneIf } from "../../../carrot2/apps/search-app/ui/Optional.js";

const foldingStore = persistentStore("carrotsearch:settings:folding", {});

export const Group = view(({ setting, get, set, className }) => {
  const { label, description } = setting;

  // We handle visibility of settings and groups by hiding the corresponding elements
  // rather than by removing/adding them to the DOM. The former is much faster.
  let groupVisible = false;
  const settings = setting.settings.map(s => {
    const settingVisible = !s.visible || s.visible();
    groupVisible |= settingVisible;
    return (
      <section key={s.id} id={s.id} style={displayNoneIf(!settingVisible)}>
        {getFactory(s)(
          s,
          s.get || setting.get || get,
          s.set || setting.set || set
        )}
      </section>
    );
  });

  const groupId = setting.id;
  if (label) {
    return (
      <Section
        className={className}
        label={label}
        style={displayNoneIf(!groupVisible)}
        isFolded={() => foldingStore[groupId]}
        onCaretClick={() => (foldingStore[groupId] = !foldingStore[groupId])}
      >
        <p>{description}</p>
        {settings}
      </Section>
    );
  } else {
    return (
      <section className={className} style={displayNoneIf(!groupVisible)}>
        {settings}
      </section>
    );
  }
});

const factories = {
  group: (s, get, set) => {
    return <Group setting={s} get={get} set={set} />;
  },

  boolean: (s, get, set) => {
    return <BooleanSetting setting={s} get={get} set={set} />;
  },

  string: (s, get, set) => {
    return <StringSetting setting={s} get={get} set={set} />;
  },

  file: (s, get, set) => {
    return <FileSetting setting={s} get={get} set={set} />;
  },

  "string-array": (s, get, set) => {
    return <StringArraySetting setting={s} get={get} set={set} />;
  },

  enum: (s, get, set) => {
    if (s.ui === "radio") {
      return <RadioSetting setting={s} get={get} set={set} />;
    }
    if (s.ui === "select") {
      return <SelectSetting setting={s} get={get} set={set} />;
    }
  },
  number: (s, get, set) => {
    if (Number.isFinite(s.min) && Number.isFinite(s.max)) {
      return <NumericSetting setting={s} get={get} set={set} />;
    } else {
      return <NumericSettingSimple setting={s} get={get} set={set} />;
    }
  },

  "service-url": (s, get, set) => {
    return <ServiceUrlSetting setting={s} get={get} set={set} />;
  }
};
const getFactory = s => {
  const factory = factories[s.type];
  if (!factory) {
    throw new Error(`Unknown factory for setting type: ${s.type}`);
  }
  return factory;
};

export const addFactory = (type, factory) => (factories[type] = factory);

Group.propTypes = {
  setting: PropTypes.object.isRequired
};
