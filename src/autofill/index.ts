/**
 * Application autofill (Advanced; ADR-0020): read a form, fill it from the
 * profile. Pure page code: no chrome, React or storage imports. It's injected
 * into the page on a click (src/entrypoints/autofill.ts), like the extractor.
 */
export { fillForm, type FillOptions, type FillReport, type SkipReason } from './fill';
export {
  detectAts,
  scanForm,
  classify,
  labelFor,
  FIELD_KEYS,
  type FieldKey,
  type FormField,
} from './fields';
