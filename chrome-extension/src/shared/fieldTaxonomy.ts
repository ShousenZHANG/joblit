/** Semantic field categories — the bridge between form fields and profile data. */
export enum FieldCategory {
  // Basic info
  FULL_NAME = "full_name",
  FIRST_NAME = "first_name",
  LAST_NAME = "last_name",
  EMAIL = "email",
  PHONE = "phone",
  LOCATION = "location",
  ADDRESS = "address",
  CITY = "city",
  STATE = "state",
  ZIPCODE = "zipcode",
  COUNTRY = "country",

  // Online links
  LINKEDIN_URL = "linkedin_url",
  GITHUB_URL = "github_url",
  PORTFOLIO_URL = "portfolio_url",
  WEBSITE_URL = "website_url",

  // Employment
  CURRENT_COMPANY = "current_company",
  CURRENT_TITLE = "current_title",
  YEARS_EXPERIENCE = "years_experience",
  DESIRED_SALARY = "desired_salary",
  AVAILABILITY = "availability",
  WORK_AUTHORIZATION = "work_authorization",
  SPONSORSHIP_REQUIRED = "sponsorship_required",

  // Education
  SCHOOL_NAME = "school_name",
  DEGREE = "degree",
  MAJOR = "major",
  GPA = "gpa",
  GRADUATION_DATE = "graduation_date",

  // Attachments
  RESUME_UPLOAD = "resume_upload",
  COVER_LETTER_UPLOAD = "cover_letter_upload",

  // Free text
  COVER_LETTER_TEXT = "cover_letter_text",
  ADDITIONAL_INFO = "additional_info",
  SUMMARY = "summary",

  // CN-specific
  WECHAT = "wechat",
  QQ = "qq",
  GENDER = "gender",
  AGE = "age",
  IDENTITY = "identity",

  // Consent
  AGREE_TERMS = "agree_terms",
  AGREE_PRIVACY = "agree_privacy",

  UNKNOWN = "unknown",
}

/** Multi-language label patterns for field classification. */
export const LABEL_PATTERNS: Record<FieldCategory, RegExp[]> = {
  [FieldCategory.FULL_NAME]: [
    /full\s*name/i,
    /your\s*name/i,
    /^name$/i,
    /applicant\s*name/i,
    /candidate\s*name/i,
    /姓名/,
    /全名/,
  ],
  [FieldCategory.FIRST_NAME]: [
    /first\s*name/i,
    /given\s*name/i,
    /名$/,
    /^名字/,
  ],
  [FieldCategory.LAST_NAME]: [
    /last\s*name/i,
    /family\s*name/i,
    /surname/i,
    /姓$/,
    /^姓氏/,
  ],
  [FieldCategory.EMAIL]: [
    /e-?mail/i,
    /邮箱/,
    /电子邮件/,
    /邮件地址/,
  ],
  [FieldCategory.PHONE]: [
    /phone/i,
    /mobile/i,
    /cell/i,
    /telephone/i,
    /手机/,
    /电话/,
    /联系方式/,
  ],
  [FieldCategory.LOCATION]: [
    /^location$/i,
    /current\s*location/i,
    /所在地/,
    /所在城市/,
  ],
  [FieldCategory.ADDRESS]: [
    /address/i,
    /street/i,
    /地址/,
    /住址/,
  ],
  [FieldCategory.CITY]: [/^city$/i, /城市/],
  [FieldCategory.STATE]: [/^state$/i, /province/i, /省份/, /州/],
  [FieldCategory.ZIPCODE]: [/zip/i, /postal/i, /邮编/, /邮政编码/],
  [FieldCategory.COUNTRY]: [/country/i, /国家/, /国籍/],

  [FieldCategory.LINKEDIN_URL]: [
    /linkedin/i,
    /领英/,
  ],
  [FieldCategory.GITHUB_URL]: [/github/i],
  [FieldCategory.PORTFOLIO_URL]: [
    /portfolio/i,
    /作品集/,
  ],
  [FieldCategory.WEBSITE_URL]: [
    /website/i,
    /personal\s*url/i,
    /blog/i,
    /个人网站/,
  ],

  [FieldCategory.CURRENT_COMPANY]: [
    /current\s*company/i,
    /employer/i,
    /company\s*name/i,
    /当前公司/,
    /目前公司/,
    /所在公司/,
  ],
  [FieldCategory.CURRENT_TITLE]: [
    /current\s*title/i,
    /job\s*title/i,
    /position/i,
    /当前职位/,
    /目前职位/,
  ],
  [FieldCategory.YEARS_EXPERIENCE]: [
    /years?\s*(of\s*)?experience/i,
    /工作年限/,
    /工作经验/,
  ],
  [FieldCategory.DESIRED_SALARY]: [
    /salary/i,
    /compensation/i,
    /薪资/,
    /期望薪酬/,
  ],
  [FieldCategory.AVAILABILITY]: [
    /availab/i,
    /start\s*date/i,
    /when\s*can\s*you/i,
    /到岗时间/,
    /入职时间/,
  ],
  [FieldCategory.WORK_AUTHORIZATION]: [
    /work\s*auth/i,
    /authorized?\s*to\s*work/i,
    /work\s*permit/i,
    /visa\s*status/i,
    /工作签证/,
  ],
  [FieldCategory.SPONSORSHIP_REQUIRED]: [
    /sponsor/i,
    /visa\s*sponsor/i,
    /需要签证/,
  ],

  [FieldCategory.SCHOOL_NAME]: [
    /school/i,
    /university/i,
    /college/i,
    /institution/i,
    /学校/,
    /院校/,
    /大学/,
  ],
  [FieldCategory.DEGREE]: [
    /degree/i,
    /qualification/i,
    /学历/,
    /学位/,
  ],
  [FieldCategory.MAJOR]: [
    /major/i,
    /field\s*of\s*study/i,
    /专业/,
  ],
  [FieldCategory.GPA]: [/gpa/i, /grade/i, /绩点/, /成绩/],
  [FieldCategory.GRADUATION_DATE]: [
    /graduat/i,
    /毕业/,
  ],

  [FieldCategory.RESUME_UPLOAD]: [
    /resume/i,
    /cv\b/i,
    /简历/,
  ],
  [FieldCategory.COVER_LETTER_UPLOAD]: [
    /cover\s*letter/i,
    /求职信/,
  ],

  [FieldCategory.COVER_LETTER_TEXT]: [
    /cover\s*letter/i,
    /求职信/,
  ],
  [FieldCategory.ADDITIONAL_INFO]: [
    /additional/i,
    /anything\s*else/i,
    /补充/,
    /其他/,
  ],
  [FieldCategory.SUMMARY]: [
    /summary/i,
    /about\s*(you|yourself)/i,
    /自我介绍/,
    /个人简介/,
  ],

  [FieldCategory.WECHAT]: [/wechat/i, /微信/],
  [FieldCategory.QQ]: [/\bqq\b/i],
  [FieldCategory.GENDER]: [/gender/i, /sex/i, /性别/],
  [FieldCategory.AGE]: [/\bage\b/i, /年龄/],
  [FieldCategory.IDENTITY]: [
    /ethnic/i,
    /race/i,
    /民族/,
    /种族/,
  ],

  [FieldCategory.AGREE_TERMS]: [
    /agree.*terms/i,
    /terms.*conditions/i,
    /accept.*terms/i,
    /同意.*条款/,
    /i\s*agree/i,
  ],
  [FieldCategory.AGREE_PRIVACY]: [
    /privacy/i,
    /data.*consent/i,
    /隐私/,
  ],

  [FieldCategory.UNKNOWN]: [],
};

/** Maps FieldCategory → flat profile key for auto-fill. */
export const PROFILE_KEY_MAP: Partial<Record<FieldCategory, string>> = {
  [FieldCategory.FULL_NAME]: "fullName",
  [FieldCategory.FIRST_NAME]: "firstName",
  [FieldCategory.LAST_NAME]: "lastName",
  [FieldCategory.EMAIL]: "email",
  [FieldCategory.PHONE]: "phone",
  [FieldCategory.LOCATION]: "location",
  [FieldCategory.CURRENT_TITLE]: "currentTitle",
  [FieldCategory.CURRENT_COMPANY]: "currentCompany",
  [FieldCategory.LINKEDIN_URL]: "linkedinUrl",
  [FieldCategory.GITHUB_URL]: "githubUrl",
  [FieldCategory.PORTFOLIO_URL]: "portfolioUrl",
  [FieldCategory.WEBSITE_URL]: "websiteUrl",
  [FieldCategory.SCHOOL_NAME]: "schoolName",
  [FieldCategory.DEGREE]: "degree",
  [FieldCategory.GRADUATION_DATE]: "graduationDates",
  [FieldCategory.SUMMARY]: "summary",
  [FieldCategory.WECHAT]: "wechat",
  [FieldCategory.QQ]: "qq",
  [FieldCategory.GENDER]: "gender",
  [FieldCategory.AGE]: "age",
  [FieldCategory.IDENTITY]: "identity",
  [FieldCategory.AVAILABILITY]: "availabilityMonth",
  [FieldCategory.AGREE_TERMS]: "agreeTerms",
  [FieldCategory.AGREE_PRIVACY]: "agreePrivacy",
};
