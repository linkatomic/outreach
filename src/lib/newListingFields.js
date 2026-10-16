// Reference option lists + pricing shape for the New Listing forms — grounded in the team's
// actual "Validation" tab (the dropdown source behind the Google Sheet this replaces) so the
// forms offer the exact same choices people are used to.

export const LISTING_STATUS_OPTIONS = [
  'Ready for live', 'On Hold', 'Do Not List', 'Live', 'Disabled', 'Details Pending',
  'GPL Rejected', 'Website Not Working', 'Added In Draft', 'Delete', 'Alternate',
  'Adult content', 'Metrics issue', 'Redirect domain', 'Reseller', 'Indexing Done', 'No Index',
]

export const LINK_TYPE_OPTIONS = ['dofollow', 'nofollow', 'ugc', 'sponsored', 'nofollow sponsored']

export const LINK_VALIDITY_OPTIONS = ['Permanent', '1 Year', '6 Months', '3 Months', '1 Month']

export const MANAGE_BY_OPTIONS = ['Rabbi IT Firm', 'Rabbi IT Author', 'Amrytt Media', 'Amrytt Media Author']

export const LANGUAGE_OPTIONS = [
  'English', 'Arabic', 'Azerbaijani', 'Bengali', 'Bulgarian', 'Chinese', 'Croatian', 'Czech',
  'Danish', 'Dutch', 'Finnish', 'French', 'Galician', 'German', 'Greek', 'Gujarati', 'Hindi',
  'Hungarian', 'Indonesian', 'Italian', 'Japanese', 'Javanese', 'Kannada', 'Korean', 'Latin',
  'Lativan', 'Lithuanian', 'Malayalam', 'Marathi', 'Polish', 'Portuguese (Brazil)',
  'Portuguese (Portugal)', 'Punjabi', 'Romanian', 'Russian', 'Serbian', 'Slovak', 'Slovenian',
  'Spanish', 'Swahili', 'Swedish', 'Tamil', 'Telugu', 'Thai', 'Turkish', 'Ukrainian',
  'Vietnamese', 'Yiddish', 'Welsh', 'Urdu', 'Persian', 'Norwegian', 'Maltese', 'Malay',
  'Macedonian', 'Irish', 'Icelandic', 'Hebrew', 'Haitian Creole', 'Georgian', 'Filipino',
  'Estonian', 'Catalan', 'Belarusian', 'Basque', 'Armenian', 'Albanian', 'Afrikaans', 'Latvian',
  'Bangla', 'Bosnian', 'Oriya',
]

export const CATEGORY_OPTIONS = [
  'General', 'Agriculture & Farming', 'Animals & Pets', 'Arts & Photography',
  'Automobiles & Cars', 'Banking & Finance', 'Beauty', 'Blockchain and Cryptocurrency',
  'Books & Literature', 'Business', 'Camping', 'Casino', 'Climbing', 'Computers & Electronics',
  'Construction & Repairs', 'Crafts and DIY', 'Culture & Society', 'Custom Order',
  'Digital Marketing & Advertising', 'E-commerce', 'Education', 'Energy', 'Entertainment',
  'Environment & Nature', 'Equipment', 'Family', 'Fashion', 'Fishing', 'Fitness', 'Food',
  'For Children', 'For Men', 'For Women', 'Gadgets & Technology', 'Gaming',
  'Gardening and Lawn Care', 'Graphics & Design', 'Health', 'Hiking', 'Home Improvement',
  'Hunting', 'Insurance', 'Internet & Telecommunication', 'Jobs & Employment', 'Legal',
  'Leisure and Hobbies', 'Lifestyle', 'Magazines & Newspapers', 'Manufacturing & Industry',
  'Music & Instruments', 'News & Media', 'Other (Miscellaneous)', 'Outdoors', 'Packages',
  'Parenting & Mommy', 'Personal Development', 'Pharmacy', 'Politics', 'Real Estate',
  'Review Sites', 'SaaS', 'Science', 'Services', 'Shopping', 'Social Media', 'Sports',
  'Tourism & Travel', 'Transport & Logistic', 'Websites & Software Development', 'Wedding',
]

export const CURRENCY_OPTIONS = [
  'USD', 'USDT', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'AFN', 'ALL', 'DZD', 'AOA', 'ARS', 'AMD',
  'AWG', 'AZN', 'BSD', 'BHD', 'BDT', 'BBD', 'BYR', 'BZD', 'BMD', 'BTN', 'BOB', 'BAM', 'BWP',
  'BRL', 'BND', 'BGN', 'BIF', 'KHR', 'CVE', 'KYD', 'GQE', 'XAF', 'XPF', 'CLP', 'CNY', 'COP',
  'KMF', 'CDF', 'CRC', 'HRK', 'CUC', 'CZK', 'DKK', 'DJF', 'DOP', 'XCD', 'EGP', 'ERN', 'EEK',
  'ETB', 'FKP', 'FJD', 'GMD', 'GEL', 'GHS', 'GIP', 'GTQ', 'GNF', 'GYD', 'HTG', 'HNL', 'HKD',
  'HUF', 'ISK', 'IDR', 'IRR', 'IQD', 'ILS', 'JMD', 'JPY', 'JOD', 'KZT', 'KES', 'KWD', 'KGS',
  'LAK', 'LVL', 'LBP', 'LSL', 'LRD', 'LYD', 'LTL', 'MOP', 'MKD', 'MGA', 'MWK', 'MYR', 'MVR',
  'MRO', 'MUR', 'MXN', 'MDL', 'MNT', 'MAD', 'MZM', 'MMK', 'NAD', 'NPR', 'ANG', 'TWD', 'NZD',
  'NIO', 'NGN', 'KPW', 'NOK', 'OMR', 'PKR', 'PAB', 'PGK', 'PYG', 'PEN', 'PHP', 'PLN', 'QAR',
  'RON', 'RUB', 'SHP', 'WST', 'SAR', 'RSD', 'SCR', 'SLL', 'SGD', 'SBD', 'SOS', 'ZAR', 'KRW',
  'XDR', 'LKR', 'SDG', 'SRD', 'SZL', 'SEK', 'CHF', 'SYP', 'TJS', 'TZS', 'THB', 'TTD', 'TND',
  'TRY', 'TMT', 'AED', 'UGX', 'UAH', 'UYU', 'UZS', 'VUV', 'VEB', 'VND', 'XOF', 'YER', 'ZMK',
  'ZWR',
]

export const AUDITOR_OPTIONS = ['Dev', 'Savan', 'Arjun', 'Neha', 'Preeti', 'Vanita', 'Shiv', 'Kandarp', 'Nagji', 'Keyur']
export const AUDIT_STATUS_OPTIONS = ['Done', 'Error', 'Improvement', 'Confusion']

// Price group labels, matching the sheet's own groupings exactly.
export const PRICE_GROUPS = [
  { key: 'post', label: 'Post Price', subs: ['general', 'cbd', 'casino', 'crypto'] },
  { key: 'link_insertion', label: 'Link Insertion Price', subs: ['general', 'cbd', 'casino', 'crypto'] },
  { key: 'foreign_language', label: 'Foreign Language', subs: ['general', 'other'] },
  { key: 'sidebar_footer', label: 'Sidebar Footer', subs: ['general', 'other'] },
]
export const PRICE_SUB_LABELS = { general: 'General', cbd: 'CBD', casino: 'Casino', crypto: 'Crypto', other: 'Casino/CBD/Crypto' }

export function emptyPricing() {
  const base = {}
  for (const g of PRICE_GROUPS) base[g.key] = Object.fromEntries(g.subs.map(s => [s, null]))
  const usd = {}
  for (const g of PRICE_GROUPS) usd[g.key] = Object.fromEntries(g.subs.map(s => [s, null]))
  base.usd = usd
  return base
}
