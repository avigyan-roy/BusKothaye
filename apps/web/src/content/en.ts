/**
 * Every visible string.
 *
 * Keeping copy here means a wording change is a one-file edit and a translation
 * is a second dictionary, not a hunt through components. Two rules hold for
 * anything added: never claim a position is confirmed when it is predicted, and
 * never describe missing information as good news ("Schedule unavailable", not
 * "On time").
 */
export const en = {
  common: {
    loading: 'Loading…',
    retry: 'Try again',
    back: 'Back',
    copy: 'Copy',
    copied: 'Copied',
    close: 'Close',
    demoBadge: 'Demo',
    demoJourney: 'Demo journey · simulated locations',
    approximateGeometry: 'Approximate route line',
  },

  header: {
    passengerLink: 'Map',
    contributeLink: 'Share GPS',
    opsLink: 'Diagnostics',
    accountLink: 'Sign in',
  },

  /* The map screen has no header, so everything else reaches a person here. */
  nav: {
    openMenu: 'Menu',
    menuLabel: 'BusKothay navigation',
    map: 'Passenger map',
    routes: 'Route catalogue',
    drive: 'Share GPS',
    demo: 'Demo console',
    signIn: 'Sign in',
  },

  sheet: {
    label: 'Journey details',
    expand: 'Show journey details',
    collapse: 'Hide journey details',
    noBus: 'No active bus',
    stopsHeading: 'Stops on this route',
    updatedAgo: (text: string) => `Updated ${text} ago`,
  },

  account: {
    title: 'Sign in to BusKothay',
    passengerEntry: 'Passenger account',
    crewEntry: 'Driver and conductor entry',
    yourAccount: 'Your account',
    honesty: 'Roles are self-declared for this community demo. They do not prove employment by WBTC or any bus operator.',
    login: 'Sign in',
    register: 'Create account',
    create: 'Create account',
    username: 'Username',
    password: 'Password',
    role: 'Selected role',
    chooseRole: 'How will you use BusKothay?',
    roles: { passenger: 'Passenger', driver: 'Driver', conductor: 'Conductor' },
    administrator: 'Administrator',
    openCrew: 'Open journey controls',
    openDemo: 'Open demo console',
    logout: 'Sign out',
    changePassword: 'Change password',
    currentPassword: 'Current password',
    newPassword: 'New password (10 characters minimum)',
    recovery: 'There is no verified email or phone on this account. If you lose the password, the deployment owner must reset the account directly.',
    requiredForCrew: 'Sign in and choose Driver or Conductor before controlling a journey.',
  },

  route: {
    chooseStop: 'Choose your stop',
    selectedStop: 'Selected stop',
    routeDetails: 'About this route',
    checkpointsNote:
      'These are selected checkpoints along the corridor, not the complete list of official stops.',
    approximateNote:
      'The route line is an approximation of the corridor. It has not been checked against the road the bus actually uses.',
    geometrySource: 'Route line',
    officialSource: 'Route identity',
    verifiedOn: 'Checked on',
    lengthLabel: 'Route length',
    scheduleUnavailable: 'Schedule unavailable',
    noSchedule: 'No timetable has been supplied for this route, so arrival times come only from contributors sharing their location.',
    showRoute: 'Show whole route',
    recenter: 'Centre on bus',
    followBus: 'Follow bus',
    stopFollowing: 'Stop following',
    locateMe: 'Locate me',
  },

  journeys: {
    none: 'No bus is sharing its location right now.',
    listUnavailable:
      'Live journey listings could not be refreshed. The stops and route information below are still available.',
    noneHelp:
      'When someone on an AC24 bus shares their location, it will appear here within a few seconds.',
    waitingFirstFix: 'Waiting for the first location.',
    waitingHelp: 'A journey has started but no location has been accepted yet.',
    selectJourney: 'Journey',
    ended: 'This journey has ended.',
    endedHelp: 'The last known position is shown. There is no live tracking on it.',
    offRoute: 'The bus appears to have left the route.',
    offRouteHelp: 'Arrival times are unavailable until it returns to the route.',
  },

  freshness: {
    live: 'Live',
    dwelling: 'Stopped',
    estimated: 'Estimated',
    stale: 'Out of date',
    pending: 'Waiting',
    ended: 'Ended',
    confirmedAgo: (text: string) => `confirmed ${text} ago`,
    lastConfirmedAgo: (text: string) => `Last confirmed ${text} ago`,
    staleMessage: 'Location is out of date. Arrival time is unavailable.',
    reconnecting: 'Reconnecting',
    approximateAccuracy: (metres: number) => `Approximate accuracy ±${metres} m`,
  },

  arrival: {
    unit: 'min',
    unavailable: 'Arrival time unavailable',
    distanceAway: (text: string) => `${text} to this stop`,
    passed: 'Passed',
    near: 'At or near the stop',
    upcoming: 'Ahead',
  },

  contribute: {
    title: 'Share this journey',
    intro:
      'This is community sharing between passengers. It is not an official operator feed, and nothing here is connected to the bus company.',
    startJourney: 'Start a journey',
    joinJourney: 'Join a journey',
    routeLabel: 'Route',
    joinCodeLabel: 'Join code',
    journeyIdLabel: 'Journey ID or link',
    joinAs: 'Join as',
    rolePassenger: 'Passenger',
    roleConductor: 'Conductor',
    roleNote:
      'A conductor can share location and end the journey. Roles are self-declared and do not prove operator employment.',
    copyCode: 'Copy join code',
    copyLink: 'Copy join link',
    openPassengerView: 'Open the passenger view',
    consentTitle: 'Before you start',
    consentBody:
      'Your location will help estimate this bus journey. Keep this screen open while sharing. You can stop at any time.',
    retentionSummary: 'What happens to my location?',
    retentionBody:
      'Reports are stored against a random contributor ID and the signed-in account that joined this journey. Leaving revokes the contributor capability. Individual reports leave the application after 48 hours; the underlying deletion happens shortly afterwards. This is opt-in pseudonymous data, not anonymous data.',
    startSharing: 'Start sharing my location',
    pauseSharing: 'Pause location sharing',
    resumeSharing: 'Resume sharing',
    stopSharing: 'Stop sharing',
    endJourney: 'End journey',
    endConfirmTitle: 'End this journey?',
    endConfirmBody:
      'Passengers will stop seeing this bus. This cannot be undone, and a new journey would need a new join code.',
    endConfirm: 'End journey',
    cancel: 'Cancel',
    sharingOn: 'Sharing your location',
    sharingOff: 'Not sharing',
    queued: (count: number) => `${count} report${count === 1 ? '' : 's'} waiting to send`,
    lastDecision: 'Last response from the server',
    accepted: 'Accepted',
    keepScreenOpen: 'Keep this screen open while sharing.',
    wakeLockDenied:
      'This browser would not keep the screen awake. If the phone locks, sharing pauses until you open this page again.',
    permissionDenied:
      'Location permission was refused, so nothing can be shared. You can allow location for this site in your browser settings and then press start again.',
    permissionUnavailable:
      'This browser did not provide a location. Check that location services are on for the browser itself, then try again.',
    backgroundWarning:
      'Web pages cannot track location in the background. If you lock the phone or switch apps, fixes stop being recorded — they are not saved up for later.',
    notSharingYet: 'Sharing has not started. Nothing is being sent.',
    sessionRestored: 'This journey is still open in this browser. Press start to share your location again.',
  },

  reject: {
    DUPLICATE: 'That report had already been received.',
    OUT_OF_ORDER: 'That report arrived out of order.',
    TOO_OLD: 'That report was too old to use.',
    POOR_ACCURACY: 'The location was not accurate enough to use. This usually means no GPS signal.',
    OFF_CORRIDOR: 'That location was too far from the route to be used.',
    IMPOSSIBLE_MOVEMENT: 'That location implied an impossible speed, so it was not used.',
    BACKWARD: 'That location moved backwards along the route, so it was not used.',
    CONSENSUS_OUTLIER: 'That location disagreed with the other people sharing on this journey.',
    AMBIGUOUS_REENTRY: 'That location was a large jump and needs a second matching report before it is used.',
    RATE_LIMITED: 'Reports are being sent too quickly.',
  },

  ops: {
    title: 'Journey diagnostics',
    tokenPrompt: 'This page needs the diagnostics capability for this journey.',
    tokenLabel: 'Diagnostics token',
    open: 'Open diagnostics',
    unauthorised: 'That token was not accepted for this journey.',
    sources: 'Sources',
    decisions: 'Recent decisions',
    events: 'Events',
    storage: 'Storage',
    fusedState: 'Fused state',
    noSources: 'No contributor has reported on this journey yet.',
    columns: {
      source: 'Source',
      role: 'Role',
      age: 'Age',
      accuracy: 'Accuracy',
      projected: 'Along route',
      offset: 'Off line',
      weight: 'Weight',
      reputation: 'Reputation',
      decision: 'Last decision',
      live: 'Live',
    },
  },

  errors: {
    routeUnavailable: 'The route information could not be loaded.',
    geometryUnavailable: 'Map geometry not available',
    geometryUnavailableHelp:
      'This route is in the catalogue, but no verified line or stop coordinates have been recorded for it yet.',
    journeyUnavailable: 'This journey could not be loaded.',
    mapFailed: 'The map could not be loaded.',
    mapFailedHelp: 'The stop list and arrival times below still work.',
    webglMissing:
      'This browser cannot draw the map, so the stop list is shown on its own.',
    notFoundTitle: 'That page does not exist',
    notFoundBody: 'The link may be out of date.',
    goToRoute: 'Go to the AC24 map',
    offline: 'Cannot reach the server.',
  },

  map: {
    developmentBasemap:
      'Development basemap. This is not the production street map, and it has limited street detail.',
    testBasemap: 'Street tiles are disabled for this deterministic test build.',
    missingKey:
      'Google Maps is not configured. Set VITE_GOOGLE_MAPS_API_KEY, then rebuild the website.',
    providerFailed:
      'The street-map style could not load. The route remains available on a plain surface.',
    tileDegraded:
      'Some street-map tiles did not load. Route tracking is still available.',
    locating: 'Finding your location…',
    locationFailed: 'Your location could not be shown. Check browser permission and location services.',
    attributionMissing: 'Map data attribution',
    busMarkerLabel: 'Bus position',
    stopMarkerLabel: 'Stop',
  },
} as const;
