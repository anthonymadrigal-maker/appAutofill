/**
 * Shared profile schema used by options.js (renders the editor),
 * popup.js (shows a summary), and content.js (knows what each
 * profile key means when it isn't just filling raw text).
 *
 * Loaded as a plain script (no modules) so it can be listed directly
 * in manifest.json's content_scripts and in options.html / popup.html.
 */

const STORAGE_KEY = "internshipAutofillProfile";

// type: "text" | "email" | "tel" | "url" | "textarea" | "select" | "yesno"
const PROFILE_SCHEMA = [
  {
    id: "personal",
    title: "Personal Information",
    fields: [
      { key: "firstName", label: "First Name", type: "text" },
      { key: "middleInitial", label: "Middle Initial", type: "text" },
      { key: "lastName", label: "Last Name", type: "text" },
      { key: "preferredName", label: "Preferred / Nickname", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone Number", type: "tel" },
      { key: "addressStreet", label: "Street Address", type: "text" },
      { key: "addressCity", label: "City", type: "text" },
      { key: "addressState", label: "State / Province", type: "text" },
      { key: "addressZip", label: "ZIP / Postal Code", type: "text" },
      { key: "addressCountry", label: "Country", type: "text", default: "United States" },
      { key: "linkedin", label: "LinkedIn URL", type: "url" },
      { key: "github", label: "GitHub URL", type: "url" },
      { key: "portfolio", label: "Portfolio / Personal Website", type: "url" },
      { key: "hrMayContactOtherPositions", label: "HR may contact me regarding other positions", type: "yesno" }
    ]
  },
  {
    id: "education",
    title: "Education",
    fields: [
      { key: "school", label: "School / University", type: "text" },
      {
        key: "degree",
        label: "Degree Level",
        type: "select",
        options: [
          "High School Diploma",
          "Associate's Degree",
          "Bachelor's Degree",
          "Master's Degree",
          "Doctorate (PhD)",
          "Other"
        ]
      },
      // Some sites split the degree question into separate "Bachelor of
      // Arts" / "Bachelor of Science" (etc.) options instead of one generic
      // "Bachelor's Degree" — content.js prefers whichever option matches
      // both the level above and this type when both are present, rather
      // than an arbitrary tie-break between equally-generic-looking
      // options. Leave blank if this doesn't apply / you're not sure.
      {
        key: "degreeType",
        label: "Degree Type (only if a site asks BA vs BS, etc.)",
        type: "select",
        options: [
          "Science (BS/MS)",
          "Arts (BA/MA)",
          "Business Administration (BBA/MBA)",
          "Fine Arts (BFA/MFA)",
          "Engineering (BEng/MEng)"
        ]
      },
      { key: "major", label: "Major / Field of Study", type: "text" },
      { key: "minor", label: "Minor (optional)", type: "text" },
      {
        key: "classStanding",
        label: "Class Standing / Year in School",
        type: "select",
        options: [
          "Freshman", "Sophomore", "Junior", "Senior",
          "Graduate / Master's Student", "PhD Candidate", "Recent Graduate"
        ]
      },
      { key: "planToAttendGradSchool", label: "Do you plan to attend graduate school?", type: "yesno" },
      { key: "currentlyEnrolled", label: "Are you currently enrolled at an accredited college or university?", type: "yesno" },
      { key: "gpa", label: "GPA", type: "text" },
      { key: "gpaScale", label: "GPA Scale", type: "text", default: "4.0" },
      {
        key: "graduationMonth",
        label: "Expected Graduation Month",
        type: "select",
        options: [
          "January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
        ]
      },
      { key: "graduationYear", label: "Expected Graduation Year", type: "text" }
    ]
  },
  {
    id: "work",
    title: "Most Recent Work Experience",
    fields: [
      { key: "employer", label: "Employer", type: "text" },
      { key: "jobTitle", label: "Job Title", type: "text" },
      { key: "workStartDate", label: "Start Date", type: "text", placeholder: "MM/YYYY" },
      { key: "workEndDate", label: "End Date", type: "text", placeholder: "MM/YYYY or Present" },
      { key: "currentlyWorking", label: "I currently work here", type: "yesno" },
      { key: "workDescription", label: "Description / Responsibilities", type: "textarea" }
    ]
  },
  {
    id: "authorization",
    title: "Work Authorization & Eligibility",
    fields: [
      { key: "usCitizen", label: "Are you a U.S. citizen?", type: "yesno" },
      { key: "workAuthorized", label: "Are you legally authorized to work in the country where this job is located?", type: "yesno" },
      { key: "needsSponsorship", label: "Will you now or in the future require sponsorship for employment visa status?", type: "yesno" },
      { key: "over18", label: "Are you at least 18 years old?", type: "yesno" },
      { key: "felonyConviction", label: "Have you ever been convicted of a felony?", type: "yesno" },
      { key: "nonCompete", label: "Are you subject to a non-compete agreement?", type: "yesno" },
      { key: "previouslyEmployedHere", label: "Have you previously been employed by this company?", type: "yesno" },
      { key: "governmentEmployee", label: "Are you currently a government employee, or have you been in the past (includes military service)?", type: "yesno" },
      { key: "relativesEmployedHere", label: "Do you have a close personal, familial, or household relationship with any employees of this company?", type: "yesno" },
      { key: "consentBackgroundCheck", label: "Do you consent to a background check?", type: "yesno" },
      { key: "securityClearanceEligible", label: "Are you eligible to obtain a security clearance?", type: "yesno" },
      { key: "securityClearanceGranted", label: "Have you ever been granted a security clearance?", type: "yesno" },
      { key: "clearanceLevel", label: "Level of Clearance (if applicable)", type: "text" }
    ]
  },
  {
    id: "eeo",
    title: "Voluntary Self-Identification (EEO)",
    description: "These questions are voluntary on most applications. Leave any of them blank if you'd rather answer manually or decline each time.",
    fields: [
      {
        key: "gender",
        label: "Gender",
        type: "select",
        options: ["Male", "Female", "Non-Binary", "Decline to answer"]
      },
      {
        key: "hispanicLatino",
        label: "Are you Hispanic or Latino?",
        type: "yesno"
      },
      {
        key: "race",
        label: "Race / Ethnicity",
        type: "select",
        options: [
          "American Indian or Alaska Native",
          "Asian",
          "Black or African American",
          "Native Hawaiian or Other Pacific Islander",
          "White",
          "Two or More Races",
          "Decline to answer"
        ]
      },
      {
        key: "veteranStatus",
        label: "Veteran Status",
        type: "select",
        options: [
          "I am not a protected veteran",
          "I identify as a protected veteran",
          "I don't wish to answer"
        ]
      },
      {
        key: "disabilityStatus",
        label: "Disability Status",
        type: "select",
        options: [
          "Yes, I have a disability (or previously had one)",
          "No, I do not have a disability",
          "I don't wish to answer"
        ]
      }
    ]
  },
  {
    id: "logistics",
    title: "Referral & Logistics",
    fields: [
      { key: "referredByEmployee", label: "Were you referred by a current employee?", type: "yesno" },
      { key: "referrerName", label: "Referring Employee's Name", type: "text" },
      { key: "willingToTravel", label: "Willing to travel for this role?", type: "yesno" },
      { key: "travelPercentage", label: "Percentage of Travel You'll Accept", type: "text", placeholder: "e.g. 25%" },
      { key: "validDriversLicense", label: "Do you have a valid driver's license?", type: "yesno" },
      {
        key: "preferredRegion",
        label: "Preferred U.S. Region",
        type: "select",
        options: ["Northeast", "Southeast", "Southwest", "West", "Midwest", "Any"]
      }
    ]
  },
  {
    id: "preferences",
    title: "Preferences",
    fields: [
      { key: "desiredSalary", label: "Desired Salary / Compensation", type: "text" },
      { key: "availableStartDate", label: "Available Start Date", type: "text" },
      { key: "willingToRelocate", label: "Willing to Relocate?", type: "yesno" },
      { key: "availableForOvertime", label: "Available for Overtime?", type: "yesno" },
      { key: "availableWeekends", label: "Able to Work Weekends?", type: "yesno" },
      { key: "availableHolidays", label: "Able to Work Holidays?", type: "yesno" },
      {
        key: "remotePreference",
        label: "Work Location Preference",
        type: "select",
        options: ["Remote", "Hybrid", "On-site", "No preference"]
      },
      { key: "howHeard", label: "How did you hear about us?", type: "text" },
      { key: "noticePeriod", label: "Notice Period", type: "text" }
    ]
  }
];

// A separate, repeatable list of jobs — not part of PROFILE_SCHEMA's flat
// field list above, since each entry needs its own Job Title / Company /
// etc. rather than one shared value. Built for application systems (e.g.
// Workday's "My Experience" page) that ask you to add each job as its own
// block via an "Add Another" button: enter jobs here in the SAME order
// you'll add the blocks on the form, and content.js fills the Nth block
// with the Nth entry, tracking its position by that block's own "Job
// Title" field (always present, always first) rather than assuming every
// field renders on every block — e.g. Workday hides the "To" date field
// entirely once "I currently work here" is checked.
// Left empty (the default), the single "Most Recent Work Experience"
// fields above are used instead, so sites that only ask for one job are
// unaffected.
// Deliberately excludes supervisor name/title/phone: some sites (SAP
// SuccessFactors confirmed) ask for a past supervisor's contact details per
// job, which is more personal than anything else here — left for the
// applicant to type by hand every time, by design, not an oversight.
const WORK_HISTORY_ENTRY_FIELDS = [
  { key: "jobTitle", label: "Job Title", type: "text" },
  { key: "company", label: "Company", type: "text" },
  { key: "location", label: "Location", type: "text" },
  { key: "typeOfBusiness", label: "Type of Business", type: "text" },
  { key: "currentlyWorkHere", label: "I currently work here", type: "checkbox" },
  { key: "startDate", label: "From", type: "text", placeholder: "MM/YYYY" },
  { key: "endDate", label: "To", type: "text", placeholder: "MM/YYYY" },
  { key: "description", label: "Role Description / Job Duties", type: "textarea" },
  { key: "reasonForLeaving", label: "Reason For Leaving", type: "text" }
];

function buildEmptyWorkHistoryEntry() {
  const entry = {};
  for (const field of WORK_HISTORY_ENTRY_FIELDS) {
    entry[field.key] = field.type === "checkbox" ? false : "";
  }
  return entry;
}

function buildDefaultProfile() {
  const profile = {};
  for (const section of PROFILE_SCHEMA) {
    for (const field of section.fields) {
      profile[field.key] = field.default !== undefined ? field.default : "";
    }
  }
  profile.workHistoryEntries = [];
  return profile;
}

// Shared across service worker, options page, popup, and content script.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STORAGE_KEY, PROFILE_SCHEMA, buildDefaultProfile,
    WORK_HISTORY_ENTRY_FIELDS, buildEmptyWorkHistoryEntry
  };
}
