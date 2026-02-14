export const KPI_DEFINITIONS: Record<string, string> = {
  // Basic Metrics - Simple explanations
  visits: "How many different people visited this zone. Each person is counted only once, even if they entered multiple times.",
  totalEntries: "Total number of times people walked into this zone. If someone enters 3 times, it counts as 3 entries.",
  timeSpent: "The total time all visitors spent in this zone combined. Useful to understand overall zone activity.",
  avgTimeSpent: "On average, how long each visitor stays in this zone. Higher = more engaging zone.",
  avgTimeSpentCT: "Average time for visitors who fully passed through (didn't start or end their journey here).",

  // Dwell Metrics - Simple explanations
  dwellAvgTime: "Average time people who 'dwelled' (stayed 60+ seconds) spent here. Shows genuine interest.",
  dwellAvgTimeCT: "Average dwell time for complete journeys only (excludes partial visits).",
  dwellsCumulative: "Total count of dwell events (staying 60+ seconds). Same person can have multiple dwells.",
  dwellsUnique: "Number of unique people who dwelled here. Each person counted once per visit.",
  dwellsPerVisit: "Average number of dwell events per visitor. Higher = people return to this zone.",
  dwellRate: "Percentage of visitors who dwelled (stayed 60+ seconds). Shows zone 'stickiness'.",
  dwellShare: "This zone's share of all dwells in the store. Shows relative importance.",

  // Engagement Metrics - Simple explanations
  engagementAvgTime: "Average time for highly engaged visitors (stayed 120+ seconds). Deep interest indicator.",
  engagementAvgTimeCT: "Average engagement time for complete journeys only.",
  engagementsCumulative: "Total engagement events (staying 120+ seconds). Shows strong interest.",
  engagementsUnique: "Number of unique people who engaged deeply. Quality over quantity.",
  engagementsPerVisit: "How often visitors become engaged per visit. Product interest indicator.",
  engagementRate: "Percentage of visitors who stayed 120+ seconds. High = compelling zone.",
  engagementShare: "This zone's share of all engagements in store. Competitive importance.",

  // Flow Metrics - Simple explanations
  draws: "People who made this their FIRST stop. Shows zone's ability to attract attention.",
  drawRate: "Percentage of visitors who started their journey here. Entry point strength.",
  drawShare: "This zone's share as a starting point vs. other zones.",
  exits: "People who made this their LAST stop before leaving. Journey endpoint.",
  exitRate: "Percentage of visitors who ended their journey here. Final destination strength.",
  exitShare: "This zone's share as an exit point vs. other zones.",
  bounces: "Visitors who ONLY visited this zone and left. Single-stop visits.",
  bounceRate: "Percentage of visitors who only stopped here. High = possible dead-end.",
  bounceShare: "This zone's share of all bounce events in store.",

  // Occupancy Metrics - Simple explanations
  peakOccupancy: "Maximum number of people in this zone at the same time. Capacity planning metric.",
  avgOccupancy: "Average number of people in this zone at any given moment.",
  currentOccupancy: "How many people are in this zone RIGHT NOW. Live count.",

  // Velocity Metrics - Simple explanations
  avgVelocity: "How fast people move through this zone on average (m/s).",
  avgVelocityInMotion: "Walking speed when actually moving (excludes standing still).",
  atRestTotalTime: "Total time people spent standing still in this zone.",
  inMotionTotalTime: "Total time people spent walking/moving in this zone.",
  percentAtRest: "Percentage of time visitors spend standing still. High = browsing zone.",
  percentInMotion: "Percentage of time visitors spend moving. High = pass-through zone.",

  // Conversion Metrics - Simple explanations
  conversions: "Number of people who completed a goal action (e.g., checkout).",
  conversionRate: "Percentage of visitors who converted. Core success metric.",
  attributedConversions: "Conversions from people who visited this zone first.",
  attributedConversionRate: "Percentage of zone visitors who later converted.",
  conversionDrivers: "Conversions that happened immediately after visiting this zone.",
  conversionDriverRate: "How often this zone directly leads to conversion.",

  // Group Metrics - Simple explanations
  groupVisits: "Number of groups (2+ people together) who visited this zone.",
  groupTimeSpent: "Total time groups spent in this zone.",
  groupAvgTimeSpent: "Average time groups spend here. Compare vs. individuals.",
  groupConversions: "Groups who converted after visiting this zone.",

  // Utilization Metrics - Simple explanations
  utilizationTime: "Minutes this zone was actively used during open hours.",
  utilizationRate: "Percentage of open hours this zone was in use. Efficiency metric.",

  // DOOH (Digital Out-Of-Home) Metrics - Simple explanations
  totalImpressions: "Total number of people who entered the screen's viewing zone. Each person = 1 impression.",
  qualifiedImpressions: "People who stayed long enough and moved slowly enough to likely see the ad. Higher quality views.",
  premiumImpressions: "Best quality views - people who stopped and paid attention. Most valuable for advertisers.",
  avgAqs: "Attention Quality Score (0-100) measuring attention quality for screen exposures.\n\n**Formula:** AQS = 100 × (0.35×Dwell + 0.20×Proximity + 0.20×Orientation + 0.15×Slowdown + 0.10×Stability)\n\n**Components:**\n• Dwell (35%): How long did they stay?\n• Proximity (20%): How close were they?\n• Orientation (20%): Were they facing the screen?\n• Slowdown (15%): Did they slow down intentionally?\n• Stability (10%): Did they stop or stay steady?\n\n**Tiers:** 70+ = Premium, 40-69 = Qualified, <40 = Low",
  totalAttention: "Total seconds all viewers spent looking at the screen. More = better engagement.",
  avgAttentionTime: "Average time each viewer spent in the viewing zone. Longer = more engagement.",
  uniqueVisitors: "Number of different people who saw the screen. Each person counted once.",
  qualifiedRate: "Percentage of impressions that were qualified (good quality). Higher = better targeting.",
  premiumRate: "Percentage of impressions that were premium (best quality). Higher = more valuable.",
  aqsDistribution: "Breakdown of attention quality scores. Shows how attention is distributed across viewers.",

  // Product Analytics Metrics - Simple explanations
  browsingRate: "Percentage of visitors who stopped to browse this shelf. Shows shelf attractiveness.",
  avgBrowseTime: "Average time shoppers spend looking at this shelf. Longer = more interest.",
  passbyCount: "Number of people who walked past without stopping. Opportunity indicator.",
  totalSlots: "Total number of product positions on the shelf.",
  occupiedSlots: "How many shelf positions have products. Higher = better stocked.",
  occupancyRate: "Percentage of shelf space being used. 100% = fully stocked.",
  shareOfShelf: "This brand/category's portion of total shelf space. Market presence indicator.",
  positionScore: "Quality of product placement (0-100). Eye-level center = highest score.",
  efficiencyIndex: "Engagement vs shelf space ratio. >1 = outperforming, <1 = underperforming.",
  avgShelfPrice: "Average price of products on this shelf.",
  estimatedEngagementValue: "Estimated revenue potential based on shopper engagement.",
  revenuePerVisit: "Average revenue generated per shopper visit to this shelf.",
}
