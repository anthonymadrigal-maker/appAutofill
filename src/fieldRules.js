/**
 * Matching heuristics that map a form field's on-page text (its label,
 * placeholder, name/id attributes, aria attributes, nearby heading, etc.)
 * to a key in PROFILE_SCHEMA.
 *
 * content.js normalizes each field's combined signal text to lowercase,
 * inserts spaces at camelCase/kebab-case/snake_case boundaries, and
 * collapses punctuation to spaces before testing it against these
 * regexes. That normalization is what lets one generic rule set cover
 * hand-written labels ("First Name") as well as framework-generated
 * attributes (id="firstName", name="first_name", data-automation-id
 *="legalName--firstName") across Greenhouse, Lever, Workday, and
 * plain hand-rolled forms, without hardcoding brittle per-site ids.
 *
 * FIELD_MATCH_ORDER controls precedence: it's checked top to bottom and
 * the first key whose rule matches "wins" a given field, so narrower /
 * more specific keys must be listed before broader ones (e.g. addressZip
 * before addressStreet, firstName before the derived fullName check).
 */

const FIELD_RULES = {
  firstName: [/\bfirst\s*name\b/, /\bgiven\s*name\b/, /\bfname\b/],
  lastName: [/\blast\s*name\b/, /\bsur\s*name\b/, /\bfamily\s*name\b/, /\blname\b/],
  preferredName: [/\bpreferred\s*name\b/, /\bnick\s*name\b/, /\bgo\s*by\b/, /\bpreferred\s*first\s*name\b/],

  email: [/\be[\s-]?mail\b/],
  // The bare "phone" pattern is anchored to exclude "home" so a separate,
  // optional "Home Phone" field (SAP SuccessFactors confirmed: shown right
  // next to a required "Cell Phone" field) is left blank rather than
  // silently duplicating the same mobile number into both.
  phone: [
    /^(?!.*\bhome\b).*\bphone\b/, /\bmobile\b/, /\btelephone\b/,
    /\bcell\s*number\b/, /\bcontact\s*number\b/
  ],
  middleInitial: [/\bmiddle\s*initial\b/, /\bmiddle\s*name\b/],

  addressZip: [/\bzip\b/, /\bpostal\s*code\b/, /\bpost\s*code\b/],
  // The trailing lookahead excludes any signal that mentions "preferred"
  // anywhere at all (label text and id/name attributes all get concatenated
  // into one signal string, so "preferred" and "region" can end up far
  // apart in it) — those are a "preferred region" question, a separate
  // PROFILE_SCHEMA field, not this address field, even though both
  // mention the word "region".
  // The lookahead on "state" excludes legal/compliance phrasing like "any
  // state, local, or international agency" (common in felony/debarment
  // questions), which would otherwise outrank those more specific keys —
  // addressState sits very early in FIELD_MATCH_ORDER since it's a common
  // field, so a bare "state" match here wins before those ever get tried.
  addressState: [
    /\bstate\b(?!.*(local|agency|government|international))/,
    /\bprovince\b/,
    /^(?!.*\bprefer(red)?\b).*\bregion\b(?!.*(country|world))/
  ],
  addressCity: [/\bcity\b/, /\btown\b/],
  addressCountry: [/\bcountry\b/, /\bnation(ality)?\b/],
  addressStreet: [/\baddress\s*line\s*1\b/, /\bstreet\s*address\b/, /\bmailing\s*address\b/, /\bstreet\b/, /\baddress\b/],

  hrMayContactOtherPositions: [/\bhr\s*may\s*contact\b/, /\bcontact\s*(you|me)\s*regarding\s*other\s*positions\b/],

  linkedin: [/\blinked\s*in\b/],
  github: [/\bgit\s*hub\b/],
  portfolio: [/\bportfolio\b/, /\bpersonal\s*website\b/, /\bwebsite\b/, /\bother\s*url\b/],

  // "college" alone is too common in unrelated questions (e.g. "current
  // year of study in college"), so it only counts here alongside a word
  // that means "which one do you attend" / "what is its name". The
  // lookbehind on "school" excludes "graduate school"/"grad school" (a
  // question about your plans, not your school's name) — that's its own
  // key below, checked first.
  school: [
    /(?<!graduate\s)(?<!grad\s)\bschool\b/, /\buniversity\b/, /\binstitution\b/, /\balma\s*mater\b/,
    /\b(college|university)\s*(name)?\b.*\b(attend|currently\s*attend)\b/,
    /\bname\s*of\s*the\s*(college|university)\b/,
    /\bwhat\s*college\b/, /\bwhich\s*college\b/
  ],
  planToAttendGradSchool: [/\bgraduate\s*school\b/, /\bgrad\s*school\b/],
  currentlyEnrolled: [
    /\bcurrently\s*enrolled\b/,
    /\benrolled\s*(at|in)\s*an?\s*(accredited\s*)?(college|university|school)\b/
  ],
  // Checked before "school" isn't necessary since school no longer matches
  // bare "college", but keep this ahead of "degree" — both mention academic
  // progress and "year of study" shouldn't fall through to a degree-level
  // select.
  classStanding: [
    /\bclass\s*standing\b/, /\byear\s*of\s*study\b/, /\bacademic\s*(standing|level)\b/,
    /\bstudent\s*(level|classification)\b/, /\bcurrent\s*year\s*in\s*(school|college)\b/
  ],
  gpaScale: [/\bgpa\s*scale\b/, /\bscale\s*max\b/],
  gpa: [/\bgpa\b/, /\bgrade\s*point\s*average\b/],
  major: [/\bmajor\b/, /\bfield\s*of\s*study\b/, /\barea\s*of\s*study\b/, /\bconcentration\b/, /\bdiscipline\b/],
  minor: [/\bminor\b/],
  graduationMonth: [/\bgraduation\s*month\b/, /\bgrad\s*month\b/],
  // Checked before "degree" below: phrasing like "what year ... will you
  // receive your degree" contains the word "degree" too, and must resolve
  // to a year, not to the degree-level select.
  graduationYear: [
    /\bgraduation\s*year\b/, /\bgrad\s*year\b/, /\bclass\s*of\b/, /\banticipated\s*graduation\b/,
    /\byear\b.*\b(receive|complete|earn|finish)\b.*\bdegree\b/,
    /\bwhat\s*year\b.*\bgraduat/
  ],
  graduationDate: [/\bgraduation\s*date\b/, /\bexpected\s*graduation\b/, /\banticipated\s*grad(uation)?\s*date\b/],
  degree: [/\bdegree\s*type\b/, /\bdegree\b/, /\beducation\s*level\b/, /\blevel\s*of\s*education\b/],

  currentlyWorking: [/\bcurrently\s*work\s*here\b/, /\bi\s*currently\s*work\b/, /\bthis\s*is\s*my\s*current\s*(job|position|employer)\b/],
  // Bare "Company" (no "name" suffix) is Workday's own label on its
  // repeatable "Work Experience" blocks.
  employer: [/\bcurrent\s*employer\b/, /\bmost\s*recent\s*employer\b/, /\bemployer\s*name\b/, /\bemployer\b/, /\bcompany\s*name\b/, /\bcompany\b/],
  jobTitle: [/\bjob\s*title\b/, /\bposition\s*title\b/, /\bcurrent\s*title\b/, /\brole\s*title\b/],
  // Bare "Location" is this same Workday block's employer-location field,
  // distinct from the applicant's own address. Excludes "preferred"/
  // "remote"/"arrangement" context so it doesn't win over remotePreference
  // or preferredRegion below, which cover actual work-location-preference
  // questions elsewhere on a form. The exclusion is anchored at the start
  // of the signal (not a trailing lookahead) since "preferred" can appear
  // either before or after "location" in the combined signal text (e.g.
  // "Preferred location").
  workLocation: [/^(?!.*\b(preferred|prefer|remote|arrangement)\b).*\blocation\b/],
  workStartDate: [/\bemployment\s*start\s*date\b/, /\bwork\s*start\s*date\b/, /\bjob\s*start\s*date\b/],
  workEndDate: [/\bemployment\s*end\s*date\b/, /\bwork\s*end\s*date\b/, /\bjob\s*end\s*date\b/],
  // Workday's From/To date fields aren't one MM/YYYY input — confirmed via
  // a live DOM dump — they're two separate text inputs per date (Month,
  // Year), each with a generic id like "...startDate-dateSectionMonth-
  // input" / "...endDate-dateSectionYear-input" and an aria-label of just
  // "Month"/"Year". Matching on the generic aria-label alone would be far
  // too broad, but requiring "start date"/"end date" together with
  // "month"/"year" in the same signal (both present in that id text) is
  // specific enough to be safe.
  workStartMonth: [/\bstart\s*date\b.*\bmonth\b/],
  workStartYear: [/\bstart\s*date\b.*\byear\b/],
  workEndMonth: [/\bend\s*date\b.*\bmonth\b/],
  workEndYear: [/\bend\s*date\b.*\byear\b/],
  workDescription: [/\bresponsibilit(y|ies)\b/, /\bjob\s*duties\b/, /\bdescription\s*of\s*(work|role|duties)\b/, /\bsummary\s*of\s*experience\b/, /\brole\s*description\b/],
  typeOfBusiness: [/\btype\s*of\s*business\b/],
  reasonForLeaving: [/\breason\s*for\s*leaving\b/, /\breason\s*(you\s*)?left\b/],

  usCitizen: [/\bu\.?\s*s\.?\s*citizen\b/, /\bcitizen\s*of\s*the\s*united\s*states\b/, /\bare\s*you\s*a\s*citizen\b/],
  needsSponsorship: [/\bsponsorship\b/, /\bsponsor(ed)?\s*(now|future)?\s*visa\b/, /\brequire\s*sponsor/],
  workAuthorized: [/\bauthorized\s*to\s*work\b/, /\blegally\s*(eligible|authorized|permitted)\b/, /\bwork\s*authorization\b/, /\beligib(le|ility)\s*to\s*work\b/],
  over18: [/\b18\s*years\s*(of\s*age|old)\b/, /\bat\s*least\s*18\b/, /\bage\s*of\s*majority\b/],
  felonyConviction: [/\bfelony\b/, /\bconvicted\s*of\s*a\s*crime\b/, /\bcriminal\s*(history|record|conviction)\b/],
  nonCompete: [/\bnon[\s-]?compete\b/, /\bnoncompete\b/],
  clearanceLevel: [/\blevel\s*of\s*clearance\b/, /\bclearance\s*level\b/],
  securityClearanceEligible: [/\beligib(le|ility)\b.*\bclearance\b/, /\bcan\s*you\s*obtain\b.*\bclearance\b/],
  securityClearanceGranted: [/\bever\s*been\s*granted\s*a\s*(security\s*)?clearance\b/, /\b(currently\s*)?hold\s*(an?\s*)?(active\s*)?(security\s*)?clearance\b/, /\bdo\s*you\s*have\s*a\s*(security\s*)?clearance\b/],
  consentBackgroundCheck: [/\bbackground\s*check\b/, /\bdrug\s*test\b/, /\bconsent\s*to\s*a\s*background\b/],
  previouslyEmployedHere: [
    /\bpreviously\s*(been\s*)?employed\b/, /\bformerly\s*employed\b/,
    /\bworked\s*(for|at)\s*(this|the)\s*company\s*before\b/,
    /\bemployed\s*(by|with)\s*(us|this\s*company)\s*(in\s*the\s*past|before)\b/,
    /\bworked\s*here\s*before\b/
  ],
  governmentEmployee: [
    /\bgovernment\s*employee\b/, /\bemployed\s*by\s*(a\s*|the\s*)?government\b/,
    /\bworked\s*for\s*(a\s*)?government\s*(entity|agency)?\b/,
    /\bgovernment\s*entity\s*currently\s*or\s*in\s*the\s*past\b/
  ],
  // EEO-style conflict-of-interest question, worded around the employer's
  // own name (e.g. "...relationship with any Hawaiian Electric employees"),
  // so matched on the generic shape rather than any one company's name.
  relativesEmployedHere: [
    /\b(personal|familial|household)\b.*\brelationship\b.*\bemploye/,
    /\brelative\b.*\bemployed\b.*\b(here|company|this)\b/
  ],

  hispanicLatino: [/\bhispanic\b/, /\blatino\b/, /\blatinx\b/, /\blatina\b/],
  race: [/\brace\b/, /\bethnicity\b/, /\bracial\b/],
  veteranStatus: [/\bveteran\b/, /\bmilitary\s*status\b/, /\barmed\s*forces\b/],
  disabilityStatus: [/\bdisability\b/, /\bdisabled\b/, /\bdifferently\s*abled\b/],
  gender: [/\bgender\s*identity\b/, /\bgender\b/, /\bsex\b(?!ual)/],

  referrerName: [
    /\bname\s*of\s*the\s*employee\s*(that|who)\s*referred\b/, /\breferring\s*employee\b/,
    /\breferrer.?s?\s*name\b/, /\bwho\s*referred\s*you\b/
  ],
  referredByEmployee: [/\breferred\s*by\s*a?\s*(current\s*)?employee\b/, /\bemployee\s*referral\b/, /\bwere\s*you\s*referred\b/],
  travelPercentage: [/\bpercentage\s*of\s*travel\b/, /\btravel\s*percentage\b/, /\bhow\s*much\s*travel\b/],
  willingToTravel: [/\bwilling\s*to\s*travel\b/, /\bable\s*to\s*travel\b/, /\btravel\s*required\b/],
  validDriversLicense: [/\bdriver.?s?\s*licen[sc]e\b/],
  preferredRegion: [/\bpreferred\s*(location|region)\b/],

  desiredSalary: [
    /\bdesired\s*salary\b/, /\bexpected\s*salary\b/, /\bsalary\s*expect/, /\bcompensation\s*expect/,
    /\bpay\s*expect/, /\bsalary\s*requirement/, /\b(salary|wage|compensation|pay)\b.*\brequir/
  ],
  availableStartDate: [
    /\bwhen\s*can\s*you\s*start\b/, /\bavailab(le|ility)\s*(to\s*start|date)\b/, /\bdate\s*availab(le|ility)\b/,
    /\bearliest\s*start\s*date\b/, /\bstart\s*date\b/
  ],
  willingToRelocate: [/\brelocat(e|ion)\b/],
  availableForOvertime: [/\bavailable\s*for\s*overtime\b/, /\bwork\s*overtime\b/, /\bwilling\s*to\s*work\s*overtime\b/],
  availableWeekends: [/\bwork\s*weekends?\b/, /\bable\s*to\s*work\s*weekends?\b/],
  availableHolidays: [/\bwork\s*holidays?\b/, /\bable\s*to\s*work\s*holidays?\b/],
  remotePreference: [/\bremote\b/, /\bwork\s*(location|arrangement)\s*preference\b/, /\blocation\s*preference\b/, /\bonsite\s*or\s*remote\b/],
  noticePeriod: [/\bnotice\s*period\b/],
  howHeard: [/\bhow\s*did\s*you\s*hear\b/, /\breferral\s*source\b/, /\bhear\s*about\s*(us|this|the\s*role|the\s*position)\b/],

  // "Typed Signature" (an e-signature attestation field on a certification
  // section — SAP SuccessFactors confirmed) expects the applicant's full
  // legal name typed as a signature, same as fullName's other patterns.
  fullName: [
    /\bfull\s*name\b/, /\blegal\s*name\b/, /\byour\s*name\b/, /^\s*name\s*$/, /\bapplicant\s*name\b/,
    /\btyped\s*signature\b/, /\be[\s-]?signature\b/
  ]
};

// Most specific / narrow first, broadest last. Any key not listed here
// is matched in the (arbitrary) order Object.keys() returns.
const FIELD_MATCH_ORDER = [
  "firstName", "middleInitial", "lastName", "preferredName",
  "email", "phone",
  "addressZip", "addressState", "addressCity", "addressCountry", "addressStreet",
  "linkedin", "github", "portfolio", "hrMayContactOtherPositions",
  "planToAttendGradSchool", "currentlyEnrolled", "school", "classStanding", "gpaScale", "gpa", "major", "minor",
  "graduationMonth", "graduationYear", "graduationDate", "degree",
  "currentlyWorking", "employer", "jobTitle", "workLocation", "typeOfBusiness", "reasonForLeaving",
  "workStartMonth", "workStartYear", "workEndMonth", "workEndYear", "workStartDate", "workEndDate", "workDescription",
  "usCitizen", "needsSponsorship", "workAuthorized", "over18", "felonyConviction", "nonCompete",
  "clearanceLevel", "securityClearanceEligible", "securityClearanceGranted", "consentBackgroundCheck", "previouslyEmployedHere",
  "governmentEmployee", "relativesEmployedHere",
  "hispanicLatino", "race", "veteranStatus", "disabilityStatus", "gender",
  "referrerName", "referredByEmployee", "travelPercentage", "willingToTravel", "validDriversLicense", "preferredRegion",
  "desiredSalary", "availableStartDate", "willingToRelocate", "availableForOvertime", "availableWeekends", "availableHolidays",
  "remotePreference", "noticePeriod", "howHeard",
  "fullName"
];

// Words that flip a single (non-grouped) yes/no checkbox's polarity, e.g.
// a checkbox labeled "I am NOT subject to a non-compete agreement".
const NEGATION_PATTERN = /\b(not|n't|never|without|decline|no\s)\b/;

// Matches follow-up fields that only make sense if a *different* question
// was answered a particular way, e.g. "If you responded 'yes' to the prior
// statement, please indicate the name of the former employer..." next to a
// legal/compliance Yes-No question. These are always skipped: filling one
// in from an unrelated profile field (e.g. dropping your current employer's
// name into a non-compete disclosure) can misrepresent a legal answer you
// never actually gave. Left for the applicant to answer by hand.
const CONDITIONAL_FOLLOWUP_PATTERN = /\bif\s*(you\s*)?(responded|answered|selected|select)\b|\bi\s*responded\b|\bif\s*(yes|no|so|applicable)\b/;

// A checkbox GROUP (multiple boxes sharing one name) whose question is
// about which term(s)/semester(s) you're available for — e.g. "Which
// term(s) are you interested in? [ ] Fall [ ] Spring [ ] Summer" — gets
// every box checked, rather than guessing a single preferred term: when
// both of these test true against the group's combined question text,
// content.js checks all of that group's boxes.
const TERM_AVAILABILITY_PATTERN = /\b(term|semester|session|quarter)s?\b/;
const AVAILABILITY_CONTEXT_PATTERN = /\b(available|availability|interested|apply|prefer)\b/;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FIELD_RULES, FIELD_MATCH_ORDER, NEGATION_PATTERN, CONDITIONAL_FOLLOWUP_PATTERN,
    TERM_AVAILABILITY_PATTERN, AVAILABILITY_CONTEXT_PATTERN
  };
}
