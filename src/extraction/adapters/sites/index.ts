// Registry of all site adapters. Keep alphabetical. Adding a site? See docs/guides/adding-a-site-adapter.md
import type { SiteAdapter } from '../types';
import adzuna from './adzuna';
import apsjobs from './apsjobs';
import ashby from './ashby';
import bamboohr from './bamboohr';
import breezy from './breezy';
import builtIn from './built-in';
import careerbuilder from './careerbuilder';
import careerone from './careerone';
import dice from './dice';
import ethicaljobs from './ethicaljobs';
import glassdoor from './glassdoor';
import gradconnection from './gradconnection';
import greenhouse from './greenhouse';
import himalayas from './himalayas';
import icims from './icims';
import indeed from './indeed';
import jazzhr from './jazzhr';
import jobadder from './jobadder';
import jobstreet from './jobstreet';
import jobvite from './jobvite';
import jora from './jora';
import lever from './lever';
import linkedin from './linkedin';
import monster from './monster';
import naukri from './naukri';
import oracleRecruiting from './oracle-recruiting';
import pageup from './pageup';
import personio from './personio';
import prosple from './prosple';
import recruitee from './recruitee';
import reed from './reed';
import remoteOk from './remote-ok';
import remotive from './remotive';
import seek from './seek';
import simplyhired from './simplyhired';
import smartrecruiters from './smartrecruiters';
import stepstone from './stepstone';
import successfactors from './successfactors';
import taleo from './taleo';
import teamtailor from './teamtailor';
import totaljobs from './totaljobs';
import usajobs from './usajobs';
import weWorkRemotely from './we-work-remotely';
import welcomeToTheJungle from './welcome-to-the-jungle';
import wellfound from './wellfound';
import workable from './workable';
import workday from './workday';
import workforceAustralia from './workforce-australia';
import yCombinator from './y-combinator';
import ziprecruiter from './ziprecruiter';

export const SITE_ADAPTERS: readonly SiteAdapter[] = [
  adzuna,
  apsjobs,
  ashby,
  bamboohr,
  breezy,
  builtIn,
  careerbuilder,
  careerone,
  dice,
  ethicaljobs,
  glassdoor,
  gradconnection,
  greenhouse,
  himalayas,
  icims,
  indeed,
  jazzhr,
  jobadder,
  jobstreet,
  jobvite,
  jora,
  lever,
  linkedin,
  monster,
  naukri,
  oracleRecruiting,
  pageup,
  personio,
  prosple,
  recruitee,
  reed,
  remoteOk,
  remotive,
  seek,
  simplyhired,
  smartrecruiters,
  stepstone,
  successfactors,
  taleo,
  teamtailor,
  totaljobs,
  usajobs,
  weWorkRemotely,
  welcomeToTheJungle,
  wellfound,
  workable,
  workday,
  workforceAustralia,
  yCombinator,
  ziprecruiter,
];
