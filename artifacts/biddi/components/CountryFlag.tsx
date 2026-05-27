import React from "react";
import { Image, type ImageStyle, type StyleProp } from "react-native";

const FLAGS: Record<string, number> = {
  ae: require("../assets/flags/ae.png"),
  ar: require("../assets/flags/ar.png"),
  au: require("../assets/flags/au.png"),
  bd: require("../assets/flags/bd.png"),
  be: require("../assets/flags/be.png"),
  bh: require("../assets/flags/bh.png"),
  br: require("../assets/flags/br.png"),
  ca: require("../assets/flags/ca.png"),
  ch: require("../assets/flags/ch.png"),
  ci: require("../assets/flags/ci.png"),
  cl: require("../assets/flags/cl.png"),
  cn: require("../assets/flags/cn.png"),
  co: require("../assets/flags/co.png"),
  de: require("../assets/flags/de.png"),
  dk: require("../assets/flags/dk.png"),
  dz: require("../assets/flags/dz.png"),
  eg: require("../assets/flags/eg.png"),
  es: require("../assets/flags/es.png"),
  fr: require("../assets/flags/fr.png"),
  gb: require("../assets/flags/gb.png"),
  gh: require("../assets/flags/gh.png"),
  id: require("../assets/flags/id.png"),
  ie: require("../assets/flags/ie.png"),
  in: require("../assets/flags/in.png"),
  it: require("../assets/flags/it.png"),
  jo: require("../assets/flags/jo.png"),
  jp: require("../assets/flags/jp.png"),
  ke: require("../assets/flags/ke.png"),
  kr: require("../assets/flags/kr.png"),
  kw: require("../assets/flags/kw.png"),
  lb: require("../assets/flags/lb.png"),
  ma: require("../assets/flags/ma.png"),
  ml: require("../assets/flags/ml.png"),
  mr: require("../assets/flags/mr.png"),
  mx: require("../assets/flags/mx.png"),
  my: require("../assets/flags/my.png"),
  ng: require("../assets/flags/ng.png"),
  nl: require("../assets/flags/nl.png"),
  no: require("../assets/flags/no.png"),
  nz: require("../assets/flags/nz.png"),
  om: require("../assets/flags/om.png"),
  ph: require("../assets/flags/ph.png"),
  pk: require("../assets/flags/pk.png"),
  pt: require("../assets/flags/pt.png"),
  qa: require("../assets/flags/qa.png"),
  sa: require("../assets/flags/sa.png"),
  se: require("../assets/flags/se.png"),
  sg: require("../assets/flags/sg.png"),
  sn: require("../assets/flags/sn.png"),
  th: require("../assets/flags/th.png"),
  tn: require("../assets/flags/tn.png"),
  tr: require("../assets/flags/tr.png"),
  us: require("../assets/flags/us.png"),
  vn: require("../assets/flags/vn.png"),
  za: require("../assets/flags/za.png"),
};

interface Props {
  isoCode: string;
  size: number;
  style?: StyleProp<ImageStyle>;
}

/** Renders a country flag from a bundled PNG asset (no network).
 * Flags are sourced from flagcdn.com (w80 PNGs), pre-downloaded into
 * `assets/flags/` so the picker works fully offline. ISO 3166-1 alpha-2. */
export default function CountryFlag({ isoCode, size, style }: Props) {
  const source = FLAGS[isoCode.toLowerCase()];
  if (!source) return null;
  return (
    <Image
      source={source}
      style={[{ width: size * 1.6, height: size }, style]}
      resizeMode="cover"
    />
  );
}
