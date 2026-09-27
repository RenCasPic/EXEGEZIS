/*
 * The parts of @exegezis/search without a browser or a model SDK, for the web
 * server: queries, costs, templates, stores, review marks, comparison and
 * exports.
 */
export { ceilCents, costUsd, DEFAULT_MAX_COST_USD, DEFAULT_SEARCH_MODEL, priceOf, PRICES, PRICES_AS_OF, PRICES_SOURCE, roughEstimateByPages } from "./cost.js";
export { DETECTOR_LABEL } from "./detectors.js";
export { describeQuery, KIND_LABEL, placeLabel, renderReportHtml, toCsv, VERDICT_LABEL, VIA_LABEL } from "./export.js";
export { describeExact, exactQueryFrom, parseTermsInput, type ExactQueryInput } from "./query.js";
export { compareSearches, markOf, readReview, REVIEW_FILE, REVIEW_LABEL, ReviewFile, ReviewMark, setReviewMark, type Comparison, type Novelty } from "./review.js";
export {
  deleteSavedSearch,
  listSavedSearches,
  readSearchSettings,
  SavedSearch,
  SavedSearchOptions,
  saveSearch,
  savedSearch,
  searchDataDir,
  SearchSettings,
  touchSavedSearch,
  writeSearchSettings,
} from "./store.js";
export { estimateSuggestCost } from "./suggest-prompt.js";
export { deleteUserTemplate, findTemplate, isDeterministic, listTemplates, saveUserTemplate, SearchTemplate, templateQuery, userTemplatesDir, type SearchTemplateInput } from "./templates.js";
