/**
 * Every word the exhibit shows a visitor, in English, Hindi and Malayalam.
 *
 * Shape: `'key': [en, hi, ml]`, indexed in the order of `LANG_ORDER` in
 * `lib/lang.ts`.  Two rules keep this honest:
 *
 * 1. **A key is stable and never displayed.**  If a translation is missing the
 *    English is shown instead (see `translate`), so a visitor never reads
 *    `page.talkToSara` on screen; `messages.test.ts` fails the build if any key
 *    lacks a language or if a placeholder differs between them.
 * 2. **Whole sentences, with `{placeholders}`.**  "Soil: {state} · {percent}",
 *    never translated fragments glued together — word order differs between
 *    these three languages, so a stitched sentence reads wrong in two of them.
 *
 * Wording is aimed at a Class 6 child or a visitor at an exhibition: short
 * sentences, everyday words, no jargon.  "Gram Sahayak" stays the role's name.
 */
export const MESSAGES = {
  // ------------------------------------------------------------------ shell ---
  'shell.skip': ['Skip to content', 'मुख्य भाग पर जाएँ', 'ഉള്ളടക്കത്തിലേക്ക് പോകുക'],
  'shell.name': ['Smart Green Village', 'स्मार्ट ग्रीन विलेज', 'സ്മാർട്ട് ഗ്രീൻ വില്ലേജ്'],
  'shell.home': [
    'Smart Green Village — back to the village',
    'स्मार्ट ग्रीन विलेज — गाँव पर वापस जाएँ',
    'സ്മാർട്ട് ഗ്രീൻ വില്ലേജ് — ഗ്രാമത്തിലേക്ക് തിരികെ',
  ],
  'shell.signOut': ['Sign out', 'साइन आउट', 'സൈൻ ഔട്ട്'],
  'shell.signOutNamed': [
    'Signed in as {user} — sign out',
    '{user} के रूप में साइन इन — साइन आउट',
    '{user} എന്ന പേരിൽ സൈൻ ഇൻ — സൈൻ ഔട്ട്',
  ],

  // ------------------------------------------------------------------- mode ---
  'mode.group': ['Village mode', 'गाँव का मोड', 'ഗ്രാമ മോഡ്'],
  'mode.simulation': ['Simulation', 'सिमुलेशन', 'സിമുലേഷൻ'],
  'mode.live': ['Live', 'लाइव', 'ലൈവ്'],
  'mode.test': ['Test', 'टेस्ट', 'ടെസ്റ്റ്'],
  'mode.simulationTitle': [
    'Invented readings, so the page can be shown without the board.',
    'काल्पनिक रीडिंग, ताकि बोर्ड के बिना भी पेज दिखाया जा सके।',
    'കെട്ടിടം ഇല്ലാതെയും പേജ് കാണിക്കാൻ കെട്ടിച്ചമച്ച വായനകൾ.',
  ],
  'mode.liveTitle': [
    'What the controller is reporting now.',
    'कंट्रोलर अभी क्या बता रहा है।',
    'കൺട്രോളർ ഇപ്പോൾ എന്താണ് അറിയിക്കുന്നത്.',
  ],
  'mode.testTitle': [
    'Bench test: drive the pump and the four LEDs by hand. Closing the panel returns to live.',
    'बेंच टेस्ट: पंप और चारों LED हाथ से चलाएँ। पैनल बंद करने पर लाइव पर वापस आ जाएगा।',
    'ബെഞ്ച് ടെസ്റ്റ്: പമ്പും നാല് LED-കളും കൈകൊണ്ട് പ്രവർത്തിപ്പിക്കുക. പാനൽ അടയ്ക്കുമ്പോൾ ലൈവിലേക്ക് മടങ്ങും.',
  ],
  'mode.simulationNote': [
    'Simulation — physical model is not controlled.',
    'सिमुलेशन — भौतिक मॉडल नियंत्रित नहीं होता।',
    'സിമുലേഷൻ — യഥാർത്ഥ മോഡൽ നിയന്ത്രിക്കുന്നില്ല.',
  ],
  'mode.testNeedsLive': [
    'Not available in Simulation — switch to Live first.',
    'सिमुलेशन में उपलब्ध नहीं — पहले लाइव पर जाएँ।',
    'സിമുലേഷനിൽ ലഭ്യമല്ല — ആദ്യം ലൈവിലേക്ക് മാറുക.',
  ],
  'mode.testNeedsController': [
    'Connect the controller to use test mode.',
    'टेस्ट मोड के लिए कंट्रोलर जोड़ें।',
    'ടെസ്റ്റ് മോഡിനായി കൺട്രോളർ ബന്ധിപ്പിക്കുക.',
  ],
  'mode.guestOnly': [
    'A shared link uses Simulation only, so nobody at the other end can move the village.',
    'साझा लिंक केवल सिमुलेशन में चलता है, ताकि दूसरी तरफ कोई गाँव को न हिला सके।',
    'പങ്കിട്ട ലിങ്ക് സിമുലേഷനിൽ മാത്രം പ്രവർത്തിക്കുന്നു, അങ്ങേയറ്റത്തുള്ള ആർക്കും ഗ്രാമം ചലിപ്പിക്കാൻ കഴിയില്ല.',
  ],

  // ------------------------------------------------------------- connection ---
  'conn.simulation': ['Simulation', 'सिमुलेशन', 'സിമുലേഷൻ'],
  'conn.offline': ['Offline', 'ऑफ़लाइन', 'ഓഫ്‌ലൈൻ'],
  'conn.stale': ['Stale', 'पुराना डेटा', 'പഴയ വിവരം'],
  'conn.live': ['Live', 'लाइव', 'ലൈവ്'],
  'conn.simulationTitle': [
    'Simulation mode: these readings are invented on the laptop. Press to go back to live readings.',
    'सिमुलेशन मोड: ये रीडिंग लैपटॉप पर बनाई गई हैं। लाइव रीडिंग पर लौटने के लिए दबाएँ।',
    'സിമുലേഷൻ മോഡ്: ഈ വായനകൾ ലാപ്ടോപ്പിൽ ഉണ്ടാക്കിയതാണ്. ലൈവ് വായനകളിലേക്ക് മടങ്ങാൻ അമർത്തുക.',
  ],
  'conn.age': ['{duration} ago', '{duration} पहले', '{duration} മുൻപ്'],
  'conn.lastFrame': [
    'Last news from the controller: {age}',
    'कंट्रोलर से आख़िरी सूचना: {age}',
    'കൺട്രോളറിൽ നിന്ന് അവസാന വിവരം: {age}',
  ],
  'conn.noFrame': [
    'No live news from the controller yet.',
    'कंट्रोलर से अभी कोई लाइव सूचना नहीं आई।',
    'കൺട്രോളറിൽ നിന്ന് ഇതുവരെ ലൈവ് വിവരം ഇല്ല.',
  ],

  // ------------------------------------------------------------------- page ---
  'page.talkToSara': ['Talk to Sara', 'सारा से बात करें', 'സാറയോട് സംസാരിക്കുക'],
  'page.language': ['Language', 'भाषा', 'ഭാഷ'],
  'page.simIntroTitle': [
    'Try changing the light, soil and water conditions. See how the village responds.',
    'रोशनी, मिट्टी और पानी की स्थिति बदलकर देखें। गाँव कैसे बदलता है, देखें।',
    'വെളിച്ചം, മണ്ണ്, വെള്ളം എന്നിവയുടെ അവസ്ഥ മാറ്റി നോക്കുക. ഗ്രാമം എങ്ങനെ മാറുന്നു എന്ന് കാണുക.',
  ],
  'page.simIntroNote': [
    'Simulation — physical model is not controlled. Nothing on this page moves the board, and these readings are invented.',
    'सिमुलेशन — भौतिक मॉडल नियंत्रित नहीं होता। इस पेज से बोर्ड नहीं चलता, और ये रीडिंग बनाई गई हैं।',
    'സിമുലേഷൻ — യഥാർത്ഥ മോഡൽ നിയന്ത്രിക്കുന്നില്ല. ഈ പേജിലെ ഒന്നും ബോർഡിനെ ചലിപ്പിക്കുന്നില്ല; ഈ വായനകൾ ഉണ്ടാക്കിയതാണ്.',
  ],
  'page.presets': ['Quick demonstrations', 'फटाफट डेमो', 'വേഗത്തിലുള്ള ഡെമോകൾ'],
  'preset.night': ['Night-time', 'रात का समय', 'രാത്രി സമയം'],
  'preset.dry': ['Dry soil', 'सूखी मिट्टी', 'വരണ്ട മണ്ണ്'],
  'preset.low': ['Low water', 'कम पानी', 'കുറഞ്ഞ വെള്ളം'],
  'preset.reset': ['Reset demo', 'डेमो रीसेट करें', 'ഡെമോ പുനഃസജ്ജമാക്കുക'],
  'preset.noteNight': [
    'Night-time: outside light set to dark, streetlights on Auto.',
    'रात का समय: बाहर की रोशनी अंधेरी कर दी, स्ट्रीट लाइट ऑटो पर।',
    'രാത്രി സമയം: പുറത്തെ വെളിച്ചം ഇരുട്ടാക്കി, തെരുവുവിളക്കുകൾ ഓട്ടോയിൽ.',
  ],
  'preset.noteDry': [
    'Dry soil: moisture below the dry threshold, water available, pump on Auto.',
    'सूखी मिट्टी: नमी सूखे की सीमा से नीचे, पानी उपलब्ध, पंप ऑटो पर।',
    'വരണ്ട മണ്ണ്: ഈർപ്പം വരണ്ട പരിധിക്ക് താഴെ, വെള്ളം ലഭ്യം, പമ്പ് ഓട്ടോയിൽ.',
  ],
  'preset.noteLow': [
    'Low water: dry soil and a low tank on Auto — watering is blocked.',
    'कम पानी: सूखी मिट्टी और टैंक कम, ऑटो पर — पानी देना बंद रहेगा।',
    'കുറഞ്ഞ വെള്ളം: വരണ്ട മണ്ണും കുറഞ്ഞ ടാങ്കും ഓട്ടോയിൽ — നനയ്ക്കൽ തടയും.',
  ],
  'preset.noteReset': [
    'Demo reset: the village is back to its starting conditions.',
    'डेमो रीसेट: गाँव शुरुआती स्थिति में वापस आ गया।',
    'ഡെമോ പുനഃസജ്ജമാക്കി: ഗ്രാമം തുടക്കത്തിലെ അവസ്ഥയിലേക്ക് മടങ്ങി.',
  ],
  'page.serviceDown': [
    'The village service is not answering.',
    'गाँव की सेवा जवाब नहीं दे रही।',
    'ഗ്രാമ സേവനം മറുപടി നൽകുന്നില്ല.',
  ],
  'page.tryAgain': ['Try again', 'फिर कोशिश करें', 'വീണ്ടും ശ്രമിക്കുക'],
  'page.notConfirmed': [
    'The controller did not confirm the action.',
    'कंट्रोलर ने काम की पुष्टि नहीं की।',
    'കൺട്രോളർ പ്രവർത്തനം സ്ഥിരീകരിച്ചില്ല.',
  ],
  'page.waiting': [
    'Waiting for the first frame…',
    'पहला डेटा आने का इंतज़ार…',
    'ആദ്യ വിവരത്തിനായി കാത്തിരിക്കുന്നു…',
  ],

  // ------------------------------------------------------------------ cards ---
  'card.watering': ['Watering', 'सिंचाई', 'നനയ്ക്കൽ'],
  'card.tank': ['Rain Water Tank', 'बारिश का पानी टैंक', 'മഴവെള്ള ടാങ്ക്'],
  'card.lights': ['Lights', 'रोशनी', 'വിളക്കുകൾ'],
  'card.waste': ['Waste', 'कचरा', 'മാലിന്യം'],
  'card.solar': ['Solar', 'सौर ऊर्जा', 'സോളാർ'],
  'card.wind': ['Wind', 'हवा', 'കാറ്റ്'],

  // ------------------------------------------------------------ state words ---
  'chip.statusUnknown': ['Status unknown', 'स्थिति अज्ञात', 'സ്ഥിതി അറിയില്ല'],
  'chip.noSensor': ['No sensor', 'सेंसर नहीं', 'സെൻസർ ഇല്ല'],
  'chip.dark': ['Dark', 'अंधेरा', 'ഇരുട്ട്'],
  'chip.bright': ['Bright', 'उजाला', 'വെളിച്ചം'],
  'chip.unknown': ['Unknown', 'अज्ञात', 'അറിയില്ല'],
  'chip.pumpRunning': ['Pump running', 'पंप चल रहा है', 'പമ്പ് പ്രവർത്തിക്കുന്നു'],
  'chip.pumpOff': ['Pump off', 'पंप बंद', 'പമ്പ് ഓഫ്'],
  'chip.modelUnknown': ['Model unknown', 'मॉडल अज्ञात', 'മോഡൽ അറിയില്ല'],
  'chip.checking': ['Checking…', 'जाँच हो रही है…', 'പരിശോധിക്കുന്നു…'],
  'chip.cameraReady': ['Camera ready', 'कैमरा तैयार', 'ക്യാമറ തയ്യാർ'],
  'chip.modelMissing': ['Model missing', 'मॉडल नहीं मिला', 'മോഡൽ ഇല്ല'],
  'chip.generating': ['Generating', 'बन रही है', 'ഉത്പാദിപ്പിക്കുന്നു'],
  'chip.notGenerating': ['Not generating', 'नहीं बन रही', 'ഉത്പാദിപ്പിക്കുന്നില്ല'],
  'chip.notFitted': ['Not fitted', 'लगा नहीं है', 'ഘടിപ്പിച്ചിട്ടില്ല'],

  'soil.dry': ['dry', 'सूखी', 'വരണ്ടത്'],
  'soil.adequate': ['adequate', 'पर्याप्त', 'മതിയായത്'],
  'soil.wet': ['wet', 'गीली', 'നനഞ്ഞത്'],
  'soil.uncalibrated': ['not calibrated', 'कैलिब्रेट नहीं', 'കാലിബ്രേറ്റ് ചെയ്തിട്ടില്ല'],
  'soil.unavailable': ['unavailable', 'उपलब्ध नहीं', 'ലഭ്യമല്ല'],
  'tank.available': ['Available', 'उपलब्ध', 'ലഭ്യം'],
  'tank.low': ['Low', 'कम', 'കുറവ്'],
  'tank.uncalibrated': ['Not calibrated', 'कैलिब्रेट नहीं', 'കാലിബ്രേറ്റ് ചെയ്തിട്ടില്ല'],
  'tank.unknown': ['Unknown', 'अज्ञात', 'അറിയില്ല'],
  'page.noReading': ['No reading', 'रीडिंग नहीं', 'വായനയില്ല'],
  'page.soilWithValue': [
    'Soil: {state} · {percent}',
    'मिट्टी: {state} · {percent}',
    'മണ്ണ്: {state} · {percent}',
  ],
  'page.soilNoValue': ['Soil: {state}', 'मिट्टी: {state}', 'മണ്ണ്: {state}'],

  // ------------------------------------------------------- tank (the card) ---
  'tank.lineAvailable': [
    'Water above the minimum',
    'पानी न्यूनतम से ऊपर',
    'വെള്ളം കുറഞ്ഞതിനും മുകളിൽ',
  ],
  'tank.lineLow': [
    'Water at or below the minimum',
    'पानी न्यूनतम पर या उससे नीचे',
    'വെള്ളം കുറഞ്ഞ അളവിൽ അല്ലെങ്കിൽ അതിന് താഴെ',
  ],
  'tank.lineUnusable': [
    'No usable probe reading',
    'जाँच से कोई काम की रीडिंग नहीं',
    'പരിശോധനയിൽ നിന്ന് ഉപയോഗിക്കാവുന്ന വായനയില്ല',
  ],
  'tank.hint': [
    'Two wires in the tank: the whole choice the real detector can make is water at the low level, or not. No percentage and no litres.',
    'टैंक में दो तारें: असली जाँच बस इतना बता सकती है कि पानी कम स्तर पर है या नहीं। कोई प्रतिशत नहीं, कोई लीटर नहीं।',
    'ടാങ്കിൽ രണ്ട് കമ്പികൾ: യഥാർത്ഥ സെൻസറിന് പറയാനാകുന്നത് വെള്ളം താഴ്ന്ന നിലയിലാണോ ഇല്ലയോ എന്ന് മാത്രം. ശതമാനവുമില്ല, ലിറ്ററുമില്ല.',
  ],
  'tank.waterAvailable': ['Water available', 'पानी उपलब्ध', 'വെള്ളം ലഭ്യം'],
  'tank.waterLow': ['Low water', 'पानी कम', 'വെള്ളം കുറവ്'],
  'tank.simGroup': ['Simulated water in the tank', 'टैंक में सिमुलेटेड पानी', 'ടാങ്കിലെ സിമുലേറ്റഡ് വെള്ളം'],

  // ------------------------------------------------------------------ pump ---
  'sim.pump': ['Pump', 'पंप', 'പമ്പ്'],
  'sim.pumpMode': ['Pump mode', 'पंप मोड', 'പമ്പ് മോഡ്'],
  'sim.auto': ['Auto', 'ऑटो', 'ഓട്ടോ'],
  'sim.on': ['On', 'चालू', 'ഓൺ'],
  'sim.off': ['Off', 'बंद', 'ഓഫ്'],
  'pump.connectBoard': [
    'Connect the board to check watering readiness.',
    'पानी देने की तैयारी जाँचने के लिए बोर्ड जोड़ें।',
    'നനയ്ക്കാൻ തയ്യാറാണോ എന്ന് അറിയാൻ ബോർഡ് ബന്ധിപ്പിക്കുക.',
  ],
  'pump.lowTank': [
    'The tank water is low. Refill the reservoir — the pump will not run, on Auto or by hand.',
    'टैंक में पानी कम है। टंकी भरें — पंप न ऑटो पर चलेगा, न हाथ से।',
    'ടാങ്കിൽ വെള്ളം കുറവാണ്. ടാങ്ക് നിറയ്ക്കുക — പമ്പ് ഓട്ടോയിലും കൈകൊണ്ടും പ്രവർത്തിക്കില്ല.',
  ],
  'pump.lowTankWithReset': [
    'The tank water is low. Refill the reservoir — the pump will not run, on Auto or by hand. Use Reset demo below to refill the demo tank.',
    'टैंक में पानी कम है। टंकी भरें — पंप न ऑटो पर चलेगा, न हाथ से। डेमो टैंक भरने के लिए नीचे Reset demo दबाएँ।',
    'ടാങ്കിൽ വെള്ളം കുറവാണ്. ടാങ്ക് നിറയ്ക്കുക — പമ്പ് ഓട്ടോയിലും കൈകൊണ്ടും പ്രവർത്തിക്കില്ല. ഡെമോ ടാങ്ക് നിറയ്ക്കാൻ താഴെ Reset demo അമർത്തുക.',
  ],
  'pump.lowTankDemo': [
    ' Use Reset in Setup → Simulation to refill the demo tank.',
    ' डेमो टैंक भरने के लिए सेटअप → सिमुलेशन में रीसेट दबाएँ।',
    ' ഡെമോ ടാങ്ക് നിറയ്ക്കാൻ സെറ്റപ്പ് → സിമുലേഷനിൽ റീസെറ്റ് അമർത്തുക.',
  ],
  'pump.offline': [
    'The controller is offline. Actions are disabled.',
    'कंट्रोलर ऑफ़लाइन है। क्रियाएँ बंद हैं।',
    'കൺട്രോളർ ഓഫ്‌ലൈനാണ്. പ്രവർത്തനങ്ങൾ അടച്ചിരിക്കുന്നു.',
  ],
  'pump.whyWaiting': [
    'Waiting for the first reading from the simulator.',
    'सिमुलेटर से पहली रीडिंग का इंतज़ार।',
    'സിമുലേറ്ററിൽ നിന്നുള്ള ആദ്യ വായനയ്ക്കായി കാത്തിരിക്കുന്നു.',
  ],
  'pump.whyManualOff': [
    'Manual Off selected → pump off.',
    'हाथ से बंद चुना → पंप बंद।',
    'കൈകൊണ്ട് ഓഫ് തിരഞ്ഞെടുത്തു → പമ്പ് ഓഫ്.',
  ],
  'pump.whyManualOnRunning': [
    'Manual On selected → the pump runs; only a low tank stops it.',
    'हाथ से चालू चुना → पंप चलता है; सिर्फ़ कम पानी उसे रोकता है।',
    'കൈകൊണ്ട് ഓൺ തിരഞ്ഞെടുത്തു → പമ്പ് പ്രവർത്തിക്കുന്നു; വെള്ളം കുറവാണെങ്കിൽ മാത്രം നിൽക്കും.',
  ],
  'pump.whyManualOnLow': [
    'Manual On cannot run the pump while the water is low.',
    'पानी कम होने पर हाथ से चालू भी पंप नहीं चला सकता।',
    'വെള്ളം കുറവായിരിക്കുമ്പോൾ കൈകൊണ്ട് ഓൺ ചെയ്താലും പമ്പ് പ്രവർത്തിക്കില്ല.',
  ],
  'pump.whyManualOnNotRunning': [
    'Manual On selected, but the pump is not running yet.',
    'हाथ से चालू चुना, पर पंप अभी चल नहीं रहा।',
    'കൈകൊണ്ട് ഓൺ തിരഞ്ഞെടുത്തു, പക്ഷേ പമ്പ് ഇതുവരെ പ്രവർത്തിക്കുന്നില്ല.',
  ],
  'pump.whyAuto': [
    'Auto is following the soil and water readings.',
    'ऑटो मिट्टी और पानी की रीडिंग देख रहा है।',
    'ഓട്ടോ മണ്ണിന്റെയും വെള്ളത്തിന്റെയും വായനകൾ പിന്തുടരുന്നു.',
  ],

  // ---------------------------------------------------------------- sliders ---
  'sim.soilLabel': ['Soil moisture indication', 'मिट्टी की नमी', 'മണ്ണിലെ ഈർപ്പം'],
  'sim.dry': ['Dry', 'सूखी', 'വരണ്ടത്'],
  'sim.wet': ['Wet', 'गीली', 'നനഞ്ഞത്'],
  'sim.soilHint': [
    'An indication from the simulated probe, not a measured amount of water in the soil.',
    'सिमुलेटेड जाँच से संकेत, मिट्टी में पानी की नापी हुई मात्रा नहीं।',
    'സിമുലേറ്റഡ് സെൻസറിൽ നിന്നുള്ള സൂചന മാത്രം; മണ്ണിലെ വെള്ളത്തിന്റെ അളവല്ല.',
  ],
  'sim.pumpThresholds': [
    'The pump follows the same thresholds, pulses and limits as the real controller.',
    'पंप वही सीमाएँ, पल्स और नियम मानता है जो असली कंट्रोलर मानता है।',
    'യഥാർത്ഥ കൺട്രോളർ പിന്തുടരുന്ന അതേ പരിധികളും പൾസുകളും പമ്പും പിന്തുടരുന്നു.',
  ],
  'sim.streetlightMode': ['Streetlight mode', 'स्ट्रीट लाइट मोड', 'തെരുവുവിളക്ക് മോഡ്'],
  'sim.outside': ['Outside', 'बाहर', 'പുറത്ത്'],
  'sim.streetlights': ['Streetlights', 'स्ट्रीट लाइट', 'തെരുവുവിളക്കുകൾ'],
  'sim.outsideLight': ['Outside light', 'बाहर की रोशनी', 'പുറത്തെ വെളിച്ചം'],
  'sim.inBetween': ['In between', 'बीच में', 'ഇടയിൽ'],
  'sim.lowLight': ['Low light', 'कम रोशनी', 'കുറഞ്ഞ വെളിച്ചം'],
  'sim.strongLight': ['Strong light', 'तेज़ रोशनी', 'ശക്തമായ വെളിച്ചം'],
  'sim.panelLight': ['Light on solar panel', 'सोलर पैनल पर रोशनी', 'സോളാർ പാനലിലെ വെളിച്ചം'],
  'sim.solarHint': [
    'Simulated values from the panel’s own circuit — volts, the current through the 330 Ω resistor, and power = volts × milliamps. Not a measurement of the real panel.',
    'पैनल के अपने सर्किट से सिमुलेटेड आँकड़े — वोल्ट, 330 Ω प्रतिरोध से करंट, और पावर = वोल्ट × मिलीएम्प। असली पैनल की नाप नहीं।',
    'പാനലിന്റെ സ്വന്തം സർക്യൂട്ടിൽ നിന്നുള്ള സിമുലേറ്റഡ് മൂല്യങ്ങൾ — വോൾട്ട്, 330 Ω റെസിസ്റ്ററിലൂടെയുള്ള കറന്റ്, പവർ = വോൾട്ട് × മില്ലിയാംപ്. യഥാർത്ഥ പാനലിന്റെ അളവല്ല.',
  ],
  'sim.windSpeed': ['Windmill speed', 'पवनचक्की की गति', 'കാറ്റാടിയുടെ വേഗം'],
  'sim.still': ['Still', 'रुका हुआ', 'നിശ്ചലം'],
  'sim.fast': ['Fast', 'तेज़', 'വേഗത്തിൽ'],
  'sim.windHint': [
    'Simulated voltage; power is not measured — the board has no second input for current.',
    'सिमुलेटेड वोल्टेज; पावर नहीं नापी जाती — बोर्ड में करंट के लिए दूसरा इनपुट नहीं है।',
    'സിമുലേറ്റഡ് വോൾട്ടേജ്; പവർ അളക്കുന്നില്ല — കറന്റിന് ബോർഡിൽ രണ്ടാമത്തെ ഇൻപുട്ടില്ല.',
  ],

  // ------------------------------------------------------------- light why ---
  'light.whyWaiting': [
    'Waiting for the first reading from the simulator.',
    'सिमुलेटर से पहली रीडिंग का इंतज़ार।',
    'സിമുലേറ്ററിൽ നിന്നുള്ള ആദ്യ വായനയ്ക്കായി കാത്തിരിക്കുന്നു.',
  ],
  'light.whyNotFitted': [
    'The streetlights are not fitted in this build.',
    'इस बिल्ड में स्ट्रीट लाइट नहीं लगी हैं।',
    'ഈ ബിൽഡിൽ തെരുവുവിളക്കുകൾ ഘടിപ്പിച്ചിട്ടില്ല.',
  ],
  'light.whyManualOn': [
    'Manual On selected → streetlights stay on.',
    'हाथ से चालू चुना → स्ट्रीट लाइट जलती रहती हैं।',
    'കൈകൊണ്ട് ഓൺ തിരഞ്ഞെടുത്തു → തെരുവുവിളക്കുകൾ കത്തുന്നു.',
  ],
  'light.whyManualOff': [
    'Manual Off selected → streetlights stay off.',
    'हाथ से बंद चुना → स्ट्रीट लाइट बंद रहती हैं।',
    'കൈകൊണ്ട് ഓഫ് തിരഞ്ഞെടുത്തു → തെരുവുവിളക്കുകൾ അണഞ്ഞിരിക്കുന്നു.',
  ],
  'light.whyDark': [
    'It is dark and Auto is selected → streetlights on.',
    'अंधेरा है और ऑटो चुना है → स्ट्रीट लाइट जलती हैं।',
    'ഇരുട്ടാണ്, ഓട്ടോ തിരഞ്ഞെടുത്തു → തെരുവുവിളക്കുകൾ കത്തുന്നു.',
  ],
  'light.whyBright': [
    'It is bright and Auto is selected → streetlights off.',
    'उजाला है और ऑटो चुना है → स्ट्रीट लाइट बंद।',
    'വെളിച്ചമുണ്ട്, ഓട്ടോ തിരഞ്ഞെടുത്തു → തെരുവുവിളക്കുകൾ അണഞ്ഞു.',
  ],
  'light.whyBetween': [
    'The light reading is between the two thresholds, so the last decision holds.',
    'रोशनी की रीडिंग दोनों सीमाओं के बीच है, इसलिए पिछला फ़ैसला ही चलेगा।',
    'വെളിച്ചത്തിന്റെ വായന രണ്ട് പരിധികൾക്കിടയിലാണ്, അതിനാൽ മുൻ തീരുമാനം തുടരും.',
  ],

  // ------------------------------------------------------------ waste card ---
  'waste.lastItem': ['Last item: {item}', 'आख़िरी चीज़: {item}', 'അവസാന വസ്തു: {item}'],
  'waste.identify': ['Identify waste', 'कचरा पहचानें', 'മാലിന്യം തിരിച്ചറിയുക'],
  'waste.identifyTitle': ['Open the waste camera.', 'कचरे का कैमरा खोलें।', 'മാലിന്യ ക്യാമറ തുറക്കുക.'],
  'waste.identifyOfflineTitle': [
    'The controller is offline. Choose Simulation above to show the classifier without the board.',
    'कंट्रोलर ऑफ़लाइन है। बोर्ड के बिना क्लासिफ़ायर दिखाने के लिए ऊपर सिमुलेशन चुनें।',
    'കൺട്രോളർ ഓഫ്‌ലൈനാണ്. ബോർഡ് ഇല്ലാതെ ക്ലാസിഫയർ കാണിക്കാൻ മുകളിൽ സിമുലേഷൻ തിരഞ്ഞെടുക്കുക.',
  ],
  'waste.trySample': ['Try a sample', 'नमूना देखें', 'ഒരു മാതൃക കാണുക'],
  'waste.trySampleTitle': [
    'Five preset items, showing what the village tells you. Not a camera result.',
    'पाँच तय चीज़ें, जो गाँव बताता है वह दिखाती हैं। कैमरे का नतीजा नहीं।',
    'ഗ്രാമം എന്ത് പറയുന്നു എന്ന് കാണിക്കുന്ന അഞ്ച് മുൻകൂട്ടി തയ്യാറാക്കിയ വസ്തുക്കൾ. ക്യാമറയുടെ ഫലമല്ല.',
  ],
  'waste.sampleNote': [
    'A sample shows the guidance for one preset item; Identify waste is the real camera classifier.',
    'नमूना एक तय चीज़ के लिए सलाह दिखाता है; कचरा पहचानें असली कैमरा क्लासिफ़ायर है।',
    'മാതൃക ഒരു വസ്തുവിനുള്ള നിർദ്ദേശം കാണിക്കുന്നു; മാലിന്യം തിരിച്ചറിയുക എന്നതാണ് യഥാർത്ഥ ക്യാമറ ക്ലാസിഫയർ.',
  ],
  'waste.offlineNote': [
    'The controller is offline. Use Simulation in Setup to show the classifier without the board.',
    'कंट्रोलर ऑफ़लाइन है। बोर्ड के बिना क्लासिफ़ायर दिखाने के लिए सेटअप में सिमुलेशन चुनें।',
    'കൺട്രോളർ ഓഫ്‌ലൈനാണ്. ബോർഡ് ഇല്ലാതെ ക്ലാസിഫയർ കാണിക്കാൻ സെറ്റപ്പിൽ സിമുലേഷൻ തിരഞ്ഞെടുക്കുക.',
  ],

  // ----------------------------------------------------------------- solar ---
  'solar.liveHint': [
    'Measured across the panel and its 330 Ω resistor: power = volts × milliamps. The LED lights only once the panel reaches about 1.8 V, so a dim panel honestly reads zero.',
    'पैनल और उसके 330 Ω प्रतिरोध पर नापा गया: पावर = वोल्ट × मिलीएम्प। LED तभी जलती है जब पैनल लगभग 1.8 V तक पहुँचे, इसलिए धुँधला पैनल सच में शून्य दिखाता है।',
    'പാനലിലും അതിന്റെ 330 Ω റെസിസ്റ്ററിലും അളന്നത്: പവർ = വോൾട്ട് × മില്ലിയാംപ്. പാനൽ ഏകദേശം 1.8 V എത്തുമ്പോൾ മാത്രം LED കത്തും; അതിനാൽ മങ്ങിയ പാനൽ സത്യമായി പൂജ്യം കാണിക്കും.',
  ],

  // ------------------------------------------------------------------ wind ---
  'wind.simulatedLine': [
    'Simulated voltage; power is not measured.',
    'सिमुलेटेड वोल्टेज; पावर नहीं नापी जाती।',
    'സിമുലേറ്റഡ് വോൾട്ടേജ്; പവർ അളക്കുന്നില്ല.',
  ],
  'wind.measuredLine': [
    'Voltage measured; power is not measured.',
    'वोल्टेज नापा गया; पावर नहीं नापी जाती।',
    'വോൾട്ടേജ് അളന്നു; പവർ അളക്കുന്നില്ല.',
  ],
  'wind.noTurbine': [
    'No turbine is wired to this board, so the windmill stands still; only the pin’s own {volts} V is reported.',
    'इस बोर्ड से कोई टर्बाइन नहीं जुड़ा, इसलिए पवनचक्की रुकी है; सिर्फ़ पिन का {volts} V बताया जाता है।',
    'ഈ ബോർഡിൽ ടർബൈൻ ഘടിപ്പിച്ചിട്ടില്ല, അതിനാൽ കാറ്റാടി നിശ്ചലമാണ്; പിൻറെ {volts} V മാത്രം അറിയിക്കുന്നു.',
  ],

  // --------------------------------------------------------------- waste: bins ---
  'waste.bin.organic.title': [
    'Organic / food waste', 'जैविक / खाद्य कचरा', 'ജൈവ / ഭക്ഷ്യ മാലിന്യം',
  ],
  'waste.bin.organic.prepare': [
    'Put it in the organic / food waste bin.',
    'इसे जैविक / खाद्य कचरा बिन में डालें।',
    'ഇത് ജൈവ / ഭക്ഷ്യ മാലിന്യ ബിന്നിൽ ഇടുക.',
  ],
  'waste.bin.organic.keepOut': [
    'Diapers, sanitary pads, medical cotton and anything contaminated do not belong here.',
    'डायपर, सैनिटरी पैड, मेडिकल रूई और कोई भी दूषित चीज़ यहाँ नहीं डालनी चाहिए।',
    'ഡയപ്പർ, സാനിറ്ററി പാഡ്, മെഡിക്കൽ പഞ്ഞി, മലിനമായ എന്തും ഇവിടെ ഇടരുത്.',
  ],
  'waste.bin.plastic.title': ['Plastic', 'प्लास्टिक', 'പ്ലാസ്റ്റിക്'],
  'waste.bin.plastic.prepare': [
    'Empty and rinse it, then put it in the plastic bin.',
    'इसे खाली करें, धोएँ, फिर प्लास्टिक बिन में डालें।',
    'ഇത് കാലിയാക്കി കഴുകിയ ശേഷം പ്ലാസ്റ്റിക് ബിന്നിൽ ഇടുക.',
  ],
  'waste.bin.plastic.keepOut': [
    'Not all plastic is recyclable. Chemical containers, contaminated items, multilayer packaging and plastics you are unsure about need the Gram Sahayak.',
    'हर प्लास्टिक रीसायकल नहीं होता। रसायन के डिब्बे, दूषित चीज़ें, कई परतों वाली पैकेजिंग और जिन प्लास्टिक के बारे में पक्का न हो, उनके लिए ग्राम सहायक से पूछें।',
    'എല്ലാ പ്ലാസ്റ്റിക്കും പുനരുപയോഗിക്കാനാകില്ല. രാസവസ്തു പാത്രങ്ങൾ, മലിനമായ വസ്തുക്കൾ, പല പാളികളുള്ള പാക്കിംഗ്, ഉറപ്പില്ലാത്ത പ്ലാസ്റ്റിക്കുകൾ — ഇവയ്ക്ക് ഗ്രാം സഹായകിനെ സമീപിക്കുക.',
  ],
  'waste.bin.paper.title': ['Paper & cardboard', 'कागज़ और कार्डबोर्ड', 'കടലാസും കാർഡ്ബോർഡും'],
  'waste.bin.paper.prepare': [
    'Keep it dry and flat, then put it in the paper & cardboard bin.',
    'इसे सूखा और सपाट रखें, फिर कागज़ और कार्डबोर्ड बिन में डालें।',
    'ഇത് ഉണങ്ങിയതും പരന്നതുമായി സൂക്ഷിച്ച് കടലാസ്, കാർഡ്ബോർഡ് ബിന്നിൽ ഇടുക.',
  ],
  'waste.bin.paper.keepOut': [
    'Coated cups, laminated packaging, used tissues and food-soiled paper do not belong here.',
    'कोटिंग वाले कप, लैमिनेटेड पैकेजिंग, इस्तेमाल किए टिश्यू और खाने से गंदे कागज़ यहाँ नहीं डालें।',
    'കോട്ടിംഗ് ഉള്ള കപ്പുകൾ, ലാമിനേറ്റഡ് പാക്കിംഗ്, ഉപയോഗിച്ച ടിഷ്യൂ, ഭക്ഷണം പുരണ്ട കടലാസ് ഇവിടെ ഇടരുത്.',
  ],

  // ------------------------------------------------------------ waste: answers ---
  'waste.word.uncertain': [
    'I’m not sure about this item. Please do not put it in a bin yet. Contact Gram Sahayak.',
    'इस चीज़ के बारे में मुझे पक्का नहीं पता। अभी इसे किसी बिन में न डालें। ग्राम सहायक से संपर्क करें।',
    'ഈ വസ്തുവിനെക്കുറിച്ച് എനിക്ക് ഉറപ്പില്ല. ഇത് ഇപ്പോൾ ബിന്നിൽ ഇടരുത്. ഗ്രാം സഹായകിനെ സമീപിക്കുക.',
  ],
  'waste.word.mixedBag': [
    'I cannot reliably identify everything inside this bag. Please show one safe item at a time, or contact Gram Sahayak.',
    'इस थैले के अंदर की हर चीज़ मैं भरोसे से नहीं पहचान सकती। एक बार में एक सुरक्षित चीज़ दिखाएँ, या ग्राम सहायक से संपर्क करें।',
    'ഈ സഞ്ചിയിലുള്ളതെല്ലാം എനിക്ക് ഉറപ്പായി തിരിച്ചറിയാനാവില്ല. ഒരു സമയം ഒരു സുരക്ഷിത വസ്തു കാണിക്കുക, അല്ലെങ്കിൽ ഗ്രാം സഹായകിനെ സമീപിക്കുക.',
  ],
  'waste.word.sanitary': [
    'Wrap securely and keep separately for authorised sanitary-waste collection. Do not place this in our three bins. Contact Gram Sahayak.',
    'इसे अच्छी तरह लपेटकर अलग रखें, ताकि अधिकृत सैनिटरी कचरा संग्रह हो सके। इसे हमारे तीन बिन में न डालें। ग्राम सहायक से संपर्क करें।',
    'നന്നായി പൊതിഞ്ഞ്, അംഗീകൃത സാനിറ്ററി മാലിന്യ ശേഖരണത്തിനായി വേർതിരിച്ച് സൂക്ഷിക്കുക. ഇത് ഞങ്ങളുടെ മൂന്ന് ബിന്നുകളിൽ ഇടരുത്. ഗ്രാം സഹായകിനെ സമീപിക്കുക.',
  ],
  'waste.word.sharps': [
    'Do not place this in our three bins or handle it for the demonstration. Ask an adult or Gram Sahayak about authorised collection.',
    'इसे हमारे तीन बिन में न डालें और न ही प्रदर्शन के लिए छुएँ। अधिकृत संग्रह के लिए किसी बड़े या ग्राम सहायक से पूछें।',
    'ഇത് ഞങ്ങളുടെ മൂന്ന് ബിന്നുകളിൽ ഇടരുത്; പ്രദർശനത്തിനായി തൊടുകയുമരുത്. അംഗീകൃത ശേഖരണത്തെക്കുറിച്ച് ഒരു മുതിർന്നയാളിനോടോ ഗ്രാം സഹായകിനോടോ ചോദിക്കുക.',
  ],
  'waste.word.outside': [
    'This item is outside our three demonstration bins. Keep it separate and contact Gram Sahayak.',
    'यह चीज़ हमारे तीन प्रदर्शन बिन से बाहर है। इसे अलग रखें और ग्राम सहायक से संपर्क करें।',
    'ഈ വസ്തു ഞങ്ങളുടെ മൂന്ന് പ്രദർശന ബിന്നുകൾക്ക് പുറത്താണ്. ഇത് വേർതിരിച്ച് സൂക്ഷിച്ച് ഗ്രാം സഹായകിനെ സമീപിക്കുക.',
  ],
  'waste.word.separateUnconfigured': [
    'Keep it separate. An authorised collection route for this material is not set up here, so contact Gram Sahayak.',
    'इसे अलग रखें। यहाँ इस सामग्री के लिए अधिकृत संग्रह व्यवस्था नहीं है, इसलिए ग्राम सहायक से संपर्क करें।',
    'ഇത് വേർതിരിച്ച് സൂക്ഷിക്കുക. ഈ വസ്തുവിന് ഇവിടെ അംഗീകൃത ശേഖരണ സംവിധാനമില്ല; അതിനാൽ ഗ്രാം സഹായകിനെ സമീപിക്കുക.',
  ],
  'waste.word.ewaste': [
    'Electronics and batteries need their own authorised collection. Do not put them in our three bins. Contact Gram Sahayak.',
    'इलेक्ट्रॉनिक सामान और बैटरी के लिए अलग अधिकृत संग्रह चाहिए। इन्हें हमारे तीन बिन में न डालें। ग्राम सहायक से संपर्क करें।',
    'ഇലക്ട്രോണിക്സും ബാറ്ററിയും പ്രത്യേക അംഗീകൃത ശേഖരണം ആവശ്യപ്പെടുന്നു. ഇവ ഞങ്ങളുടെ മൂന്ന് ബിന്നുകളിൽ ഇടരുത്. ഗ്രാം സഹായകിനെ സമീപിക്കുക.',
  ],
  'waste.word.glassRoute': [
    'Keep it separate for the glass collection route. It does not go in our three bins.',
    'काँच के संग्रह के लिए इसे अलग रखें। यह हमारे तीन बिन में नहीं जाता।',
    'ഗ്ലാസ് ശേഖരണത്തിനായി ഇത് വേർതിരിച്ച് സൂക്ഷിക്കുക. ഇത് ഞങ്ങളുടെ മൂന്ന് ബിന്നുകളിൽ ഇടുന്നില്ല.',
  ],
  'waste.word.metalRoute': [
    'Keep it separate for the metal collection route. It does not go in our three bins.',
    'धातु के संग्रह के लिए इसे अलग रखें। यह हमारे तीन बिन में नहीं जाता।',
    'ലോഹ ശേഖരണത്തിനായി ഇത് വേർതിരിച്ച് സൂക്ഷിക്കുക. ഇത് ഞങ്ങളുടെ മൂന്ന് ബിന്നുകളിൽ ഇടുന്നില്ല.',
  ],
  'waste.title.keepSeparate': ['Keep separate', 'अलग रखें', 'വേർതിരിച്ച് സൂക്ഷിക്കുക'],
  'waste.title.askSahayak': ['Ask the Gram Sahayak', 'ग्राम सहायक से पूछें', 'ഗ്രാം സഹായകിനോട് ചോദിക്കുക'],
  'waste.title.doNotHandle': ['Do not handle', 'छुएँ नहीं', 'തൊടരുത്'],
  'waste.title.keepForCollection': [
    'Keep separate for collection', 'संग्रह के लिए अलग रखें', 'ശേഖരണത്തിനായി വേർതിരിച്ച് സൂക്ഷിക്കുക',
  ],

  // ------------------------------------------------------------- waste: names ---
  'waste.item.organic': ['Organic / food waste', 'जैविक / खाद्य कचरा', 'ജൈവ / ഭക്ഷ്യ മാലിന്യം'],
  'waste.item.plastic': ['Plastic', 'प्लास्टिक', 'പ്ലാസ്റ്റിക്'],
  'waste.item.paper': ['Paper & cardboard', 'कागज़ और कार्डबोर्ड', 'കടലാസും കാർഡ്ബോർഡും'],
  'waste.item.glass': ['Glass', 'काँच', 'ഗ്ലാസ്'],
  'waste.item.metal': ['Metal', 'धातु', 'ലോഹം'],
  'waste.item.textile': ['Cloth or textile', 'कपड़ा', 'തുണി'],
  'waste.item.leather': ['Leather', 'चमड़ा', 'തോൽ'],
  'waste.item.footwear': ['Footwear', 'जूते-चप्पल', 'ചെരിപ്പ്'],
  'waste.item.thermocol': ['Thermocol', 'थर्मोकोल', 'തെർമോകോൾ'],
  'waste.item.ewaste': ['Electronic waste', 'इलेक्ट्रॉनिक कचरा', 'ഇലക്ട്രോണിക് മാലിന്യം'],
  'waste.item.background': ['Not a waste item', 'कचरा नहीं है', 'മാലിന്യമല്ല'],
  'waste.item.mixedBag': ['Mixed bag / several items', 'मिला-जुला थैला / कई चीज़ें', 'കലർന്ന സഞ്ചി / പല വസ്തുക്കൾ'],
  'waste.item.uncertain': ['Not a clear item', 'साफ़ चीज़ नहीं', 'വ്യക്തമായ വസ്തുവല്ല'],
  'waste.item.nothing': ['Nothing recognised', 'कुछ पहचाना नहीं गया', 'ഒന്നും തിരിച്ചറിഞ്ഞില്ല'],

  // ----------------------------------------------------------- waste: samples ---
  'samples.eyebrow': ['Sample demonstration', 'नमूना प्रदर्शन', 'മാതൃകാ പ്രദർശനം'],
  'samples.title': ['Try a sample', 'नमूना देखें', 'ഒരു മാതൃക കാണുക'],
  'samples.intro': [
    'These five are preset examples of what the village tells you. They are not a camera result — the camera on Identify waste is the real classifier.',
    'ये पाँच तय उदाहरण हैं, जो दिखाते हैं गाँव क्या बताता है। ये कैमरे का नतीजा नहीं हैं — कचरा पहचानें वाला कैमरा असली क्लासिफ़ायर है।',
    'ഗ്രാമം എന്ത് പറയുന്നു എന്ന് കാണിക്കുന്ന അഞ്ച് മുൻകൂട്ടി തയ്യാറാക്കിയ ഉദാഹരണങ്ങളാണ് ഇവ. ഇവ ക്യാമറയുടെ ഫലമല്ല — മാലിന്യം തിരിച്ചറിയുക എന്നതിലെ ക്യാമറയാണ് യഥാർത്ഥ ക്ലാസിഫയർ.',
  ],
  'samples.close': ['Close the samples', 'नमूने बंद करें', 'മാതൃകകൾ അടയ്ക്കുക'],
  'samples.guidanceEyebrow': [
    'Preset guidance — not a camera result', 'तय सलाह — कैमरे का नतीजा नहीं', 'മുൻകൂട്ടിയുള്ള നിർദ്ദേശം — ക്യാമറയുടെ ഫലമല്ല',
  ],
  'samples.keepOut': ['Keep out:', 'इन्हें न डालें:', 'ഇവ ഇടരുത്:'],
  'samples.noLed': [
    'No bin LED is lit for a sample: nothing was classified.',
    'नमूने के लिए कोई बिन LED नहीं जलती: कुछ पहचाना नहीं गया।',
    'മാതൃകയ്ക്ക് ബിൻ LED കത്തുന്നില്ല: ഒന്നും ക്ലാസിഫൈ ചെയ്തിട്ടില്ല.',
  ],
  'sample.banana': ['Banana peel', 'केले का छिलका', 'വാഴത്തോൽ'],
  'sample.bottle': ['Empty plastic bottle', 'खाली प्लास्टिक बोतल', 'കാലിയായ പ്ലാസ്റ്റിക് കുപ്പി'],
  'sample.newspaper': ['Newspaper', 'अख़बार', 'പത്രം'],
  'sample.glass': ['Glass bottle', 'काँच की बोतल', 'ഗ്ലാസ് കുപ്പി'],
  'sample.battery': ['Used battery', 'इस्तेमाल की बैटरी', 'ഉപയോഗിച്ച ബാറ്ററി'],
  'sample.recyclingAgent': ['Recycling agent', 'रीसाइक्लिंग एजेंट', 'റീസൈക്ലിംഗ് ഏജന്റ്'],

  // --------------------------------------------------------------- waste: page ---
  'wasteDialog.eyebrow': ['Sort waste', 'कचरा छाँटें', 'മാലിന്യം തരംതിരിക്കുക'],
  'wasteDialog.title': ['Show one item to the camera', 'कैमरे को एक चीज़ दिखाएँ', 'ക്യാമറയ്ക്ക് ഒരു വസ്തു കാണിക്കുക'],
  'wasteDialog.done': ['Done — back to the village', 'हो गया — गाँव पर वापस', 'കഴിഞ്ഞു — ഗ്രാമത്തിലേക്ക് തിരികെ'],
  'wasteDialog.aria': ['Sort waste', 'कचरा छाँटें', 'മാലിന്യം തരംതിരിക്കുക'],

  // ------------------------------------------------------- waste: the camera ---
  'sort.previewAria': ['Waste camera preview', 'कचरे के कैमरे की झलक', 'മാലിന്യ ക്യാമറ കാഴ്ച'],
  'sort.whatReading': ['What it is reading', 'कैमरा क्या पढ़ रहा है', 'ക്യാമറ എന്താണ് വായിക്കുന്നത്'],
  'sort.learningRoom': [
    'Learning the room · {percent}%', 'कमरा सीख रहे हैं · {percent}%', 'മുറി പഠിക്കുന്നു · {percent}%',
  ],
  'sort.showNextItem': ['Show the next item', 'अगली चीज़ दिखाएँ', 'അടുത്ത വസ്തു കാണിക്കുക'],
  'sort.readyShow': ['Ready — show one item', 'तैयार — एक चीज़ दिखाएँ', 'തയ്യാർ — ഒരു വസ്തു കാണിക്കുക'],
  'sort.readyPress': [
    'Ready — press “Check the item”', 'तैयार — “चीज़ जाँचें” दबाएँ', 'തയ്യാർ — “വസ്തു പരിശോധിക്കുക” അമർത്തുക',
  ],
  'sort.startThenShow': [
    'Start the camera, then show one clean item.',
    'कैमरा चालू करें, फिर एक साफ़ चीज़ दिखाएँ।',
    'ക്യാമറ ഓൺ ചെയ്ത് ഒരു വൃത്തിയുള്ള വസ്തു കാണിക്കുക.',
  ],
  'sort.offlineHint': [
    'The controller is offline, so the camera is not offered: a recognised item could not light its bin LED. Turn on Simulation above to show the classifier without the board.',
    'कंट्रोलर ऑफ़लाइन है, इसलिए कैमरा नहीं दिया जा रहा: पहचानी गई चीज़ अपनी बिन LED नहीं जला सकती। बोर्ड के बिना क्लासिफ़ायर दिखाने के लिए ऊपर सिमुलेशन चालू करें।',
    'കൺട്രോളർ ഓഫ്‌ലൈനാണ്, അതിനാൽ ക്യാമറ നൽകുന്നില്ല: തിരിച്ചറിഞ്ഞ വസ്തുവിന് അതിന്റെ ബിൻ LED കത്തിക്കാനാവില്ല. ബോർഡ് ഇല്ലാതെ ക്ലാസിഫയർ കാണിക്കാൻ മുകളിൽ സിമുലേഷൻ ഓണാക്കുക.',
  ],
  'sort.stopCamera': ['Stop Camera', 'कैमरा बंद करें', 'ക്യാമറ നിർത്തുക'],
  'sort.startCamera': ['Start Camera', 'कैमरा चालू करें', 'ക്യാമറ ഓൺ ചെയ്യുക'],
  'sort.preparingModel': ['Preparing the model…', 'मॉडल तैयार हो रहा है…', 'മോഡൽ തയ്യാറാക്കുന്നു…'],
  'sort.titleOffline': [
    'The controller is offline, so no bin LED could light. Choose Simulation above to show the classifier without the board.',
    'कंट्रोलर ऑफ़लाइन है, इसलिए कोई बिन LED नहीं जल सकती। बोर्ड के बिना क्लासिफ़ायर दिखाने के लिए ऊपर सिमुलेशन चुनें।',
    'കൺട്രോളർ ഓഫ്‌ലൈനാണ്, അതിനാൽ ബിൻ LED കത്തില്ല. ബോർഡ് ഇല്ലാതെ ക്ലാസിഫയർ കാണിക്കാൻ മുകളിൽ സിമുലേഷൻ തിരഞ്ഞെടുക്കുക.',
  ],
  'sort.titleNoBrowser': [
    'This browser cannot open a camera in this tab.',
    'यह ब्राउज़र इस टैब में कैमरा नहीं खोल सकता।',
    'ഈ ബ്രൗസറിന് ഈ ടാബിൽ ക്യാമറ തുറക്കാനാവില്ല.',
  ],
  'sort.titleLoading': [
    'The classifier is still loading. The camera opens once it is ready.',
    'क्लासिफ़ायर अभी लोड हो रहा है। तैयार होते ही कैमरा खुलेगा।',
    'ക്ലാസിഫയർ ഇപ്പോൾ ലോഡ് ചെയ്യുന്നു. തയ്യാറാകുമ്പോൾ ക്യാമറ തുറക്കും.',
  ],
  'sort.titleOpen': ['Open the camera preview.', 'कैमरे की झलक खोलें।', 'ക്യാമറ കാഴ്ച തുറക്കുക.'],
  'sort.titlePreviewOnly': [
    'Open the camera preview. Recognition stays off until a model is installed.',
    'कैमरे की झलक खोलें। मॉडल लगने तक पहचान बंद रहेगी।',
    'ക്യാമറ കാഴ്ച തുറക്കുക. മോഡൽ ഇൻസ്റ്റാൾ ചെയ്യുന്നതുവരെ തിരിച്ചറിയൽ ഓഫ് ആയിരിക്കും.',
  ],
  'sort.setBackground': ['Set background', 'पृष्ठभूमि सेट करें', 'പശ്ചാത്തലം ക്രമീകരിക്കുക'],
  'sort.addBackground': ['Add background', 'पृष्ठभूमि जोड़ें', 'പശ്ചാത്തലം ചേർക്കുക'],
  'sort.clearBackgrounds': ['Clear backgrounds', 'पृष्ठभूमि हटाएँ', 'പശ്ചാത്തലങ്ങൾ നീക്കുക'],
  'sort.focusOnObject': ['Focus on the object', 'सिर्फ़ चीज़ पर ध्यान', 'വസ്തുവിൽ മാത്രം ശ്രദ്ധിക്കുക'],
  'sort.watchAutomatically': ['Watch automatically', 'अपने आप देखें', 'സ്വയം നിരീക്ഷിക്കുക'],
  'sort.hazardous': ['Hazardous / medical', 'खतरनाक / मेडिकल', 'അപകടകരം / മെഡിക്കൽ'],
  'sort.cameraDevice': ['Camera device', 'कैमरा', 'ക്യാമറ'],
  'sort.defaultCamera': ['Default camera', 'डिफ़ॉल्ट कैमरा', 'സ്ഥിര ക്യാമറ'],
  'sort.stopToChoose': [
    'Stop the camera to choose another device.', 'दूसरा कैमरा चुनने के लिए कैमरा बंद करें।',
    'മറ്റൊരു ക്യാമറ തിരഞ്ഞെടുക്കാൻ ക്യാമറ നിർത്തുക.',
  ],
  'sort.pickDevice': [
    'Pick the camera to use — a laptop usually has a built-in one and may have an external USB camera as well.',
    'कौन-सा कैमरा चलाना है चुनें — लैपटॉप में आमतौर पर एक कैमरा पहले से होता है और बाहरी USB कैमरा भी हो सकता है।',
    'ഏത് ക്യാമറ ഉപയോഗിക്കണം എന്ന് തിരഞ്ഞെടുക്കുക — ലാപ്ടോപ്പിൽ സാധാരണ ഒരു ക്യാമറ ഉണ്ടാകും; പുറത്തെ USB ക്യാമറയും ഉണ്ടായേക്കാം.',
  ],
  'sort.labelsHint': [
    'Camera names appear after this page is allowed to use a camera once: press Start camera, allow it, then stop and pick the external camera by name.',
    'कैमरों के नाम तब दिखते हैं जब इस पेज को एक बार कैमरा इस्तेमाल करने की अनुमति मिल जाए: कैमरा चालू करें, अनुमति दें, फिर बंद करके बाहरी कैमरा नाम से चुनें।',
    'ഈ പേജിന് ഒരിക്കൽ ക്യാമറ ഉപയോഗിക്കാൻ അനുമതി നൽകിയാൽ ക്യാമറകളുടെ പേരുകൾ കാണാം: ക്യാമറ ഓൺ ചെയ്ത് അനുമതി നൽകി, നിർത്തിയ ശേഷം പുറത്തെ ക്യാമറ പേര് നോക്കി തിരഞ്ഞെടുക്കുക.',
  ],
  'sort.notOneClean': ['Not one clean item, or not sure?', 'एक साफ़ चीज़ नहीं, या पक्का नहीं?', 'ഒരു വൃത്തിയുള്ള വസ്തുവല്ലേ, അല്ലെങ്കിൽ ഉറപ്പില്ലേ?'],
  'sort.mixedBag': ['Mixed bag / several items', 'मिला-जुला थैला / कई चीज़ें', 'കലർന്ന സഞ്ചി / പല വസ്തുക്കൾ'],
  'sort.sanitary': ['Sanitary waste', 'सैनिटरी कचरा', 'സാനിറ്ററി മാലിന്യം'],
  'sort.sharps': ['Sharp or medical', 'नुकीली या मेडिकल चीज़', 'കൂർത്തതോ മെഡിക്കലോ ആയ വസ്തു'],
  'sort.promptNoBrowser': [
    'This browser cannot open a camera in this tab, so Start Camera is disabled.',
    'यह ब्राउज़र इस टैब में कैमरा नहीं खोल सकता, इसलिए कैमरा चालू करें बंद है।',
    'ഈ ബ്രൗസറിന് ഈ ടാബിൽ ക്യാമറ തുറക്കാനാവില്ല, അതിനാൽ ക്യാമറ ഓൺ ചെയ്യുക പ്രവർത്തിക്കില്ല.',
  ],
  'sort.promptModelUnknown': [
    'The camera can be previewed, but recognition cannot be checked right now.',
    'कैमरे की झलक देख सकते हैं, पर अभी पहचान जाँची नहीं जा सकती।',
    'ക്യാമറ കാഴ്ച കാണാം, പക്ഷേ ഇപ്പോൾ തിരിച്ചറിയൽ പരിശോധിക്കാനാവില്ല.',
  ],
  'sort.promptHoldStill': [
    'Show one item to the camera. Hold it still.',
    'कैमरे को एक चीज़ दिखाएँ। उसे स्थिर रखें।',
    'ക്യാമറയ്ക്ക് ഒരു വസ്തു കാണിക്കുക. അത് അനങ്ങാതെ പിടിക്കുക.',
  ],
  'sort.promptStart': ['Start the camera to begin.', 'शुरू करने के लिए कैमरा चालू करें।', 'തുടങ്ങാൻ ക്യാമറ ഓൺ ചെയ്യുക.'],
  'sort.promptPreviewOnly': [
    'Preview only — the recognition model is not installed.',
    'सिर्फ़ झलक — पहचान का मॉडल नहीं लगा है।',
    'കാഴ്ച മാത്രം — തിരിച്ചറിയൽ മോഡൽ ഇൻസ്റ്റാൾ ചെയ്തിട്ടില്ല.',
  ],
  'sort.promptPreviewModel': [
    'Start the camera for a preview. Recognition needs the model.',
    'झलक के लिए कैमरा चालू करें। पहचान के लिए मॉडल चाहिए।',
    'കാഴ്ചയ്ക്കായി ക്യാമറ ഓൺ ചെയ്യുക. തിരിച്ചറിയലിന് മോഡൽ വേണം.',
  ],
  'sort.holdStill': [
    'Hold it still for a few seconds.', 'इसे कुछ सेकंड स्थिर रखें।', 'ഇത് കുറച്ച് സെക്കൻഡ് അനങ്ങാതെ പിടിക്കുക.',
  ],
  'sort.oneAtATime': [
    'One item at a time. After an item is recognised, remove it; the camera arms itself for the next one.',
    'एक बार में एक चीज़। चीज़ पहचान लेने के बाद उसे हटा दें; कैमरा अगली के लिए खुद तैयार हो जाता है।',
    'ഒരു സമയം ഒരു വസ്തു. വസ്തു തിരിച്ചറിഞ്ഞാൽ അത് എടുത്തുമാറ്റുക; ക്യാമറ അടുത്തതിനായി സ്വയം തയ്യാറാകും.',
  ],

  // ------------------------------------------------------- waste: the result ---
  'sort.kickerKeepOut': ['Keep it out of the bins', 'बिन से बाहर रखें', 'ബിന്നുകൾക്ക് പുറത്ത് സൂക്ഷിക്കുക'],
  'sort.kickerBin': ['Suggested bin', 'सुझाया बिन', 'നിർദ്ദേശിച്ച ബിൻ'],
  'sort.titleRemove': ['Remove the item', 'चीज़ हटाएँ', 'വസ്തു എടുത്തുമാറ്റുക'],
  'sort.titleWaiting': ['Waiting for an item', 'चीज़ का इंतज़ार', 'വസ്തുവിനായി കാത്തിരിക്കുന്നു'],
  'sort.putInBin': [
    'Put it in the {bin} bin', '{bin} बिन में डालें', '{bin} ബിന്നിൽ ഇടുക',
  ],
  'sort.noDestination': [
    'No destination could be worked out for this item. Contact the Gram Sahayak.',
    'इस चीज़ के लिए कोई जगह तय नहीं हो सकी। ग्राम सहायक से संपर्क करें।',
    'ഈ വസ്തുവിന് എവിടെ ഇടണമെന്ന് തീരുമാനിക്കാനായില്ല. ഗ്രാം സഹായകിനെ സമീപിക്കുക.',
  ],
  'sort.supportDesk': [
    'Ask the Gram Sahayak at the demonstration desk.',
    'प्रदर्शन डेस्क पर ग्राम सहायक से पूछें।',
    'പ്രദർശന കൗണ്ടറിലുള്ള ഗ്രാം സഹായകിനോട് ചോദിക്കുക.',
  ],
  'sort.notProof': [
    'This is a camera suggestion, not proof that the item is safe or that it went in the bin.',
    'यह कैमरे का सुझाव है, इस बात का सबूत नहीं कि चीज़ सुरक्षित है या बिन में गई है।',
    'ഇത് ക്യാമറയുടെ നിർദ്ദേശം മാത്രമാണ്; വസ്തു സുരക്ഷിതമാണെന്നോ ബിന്നിൽ ഇട്ടുവെന്നോ ഉള്ള തെളിവല്ല.',
  ],
  'sort.wrongItWas': ['Wrong? It was…', 'ग़लत? यह था…', 'തെറ്റോ? ഇതായിരുന്നു…'],
  'sort.correctOrganic': ['Organic', 'जैविक', 'ജൈവം'],
  'sort.correctPlastic': ['Plastic', 'प्लास्टिक', 'പ്ലാസ്റ്റിക്'],
  'sort.correctPaper': ['Paper', 'कागज़', 'കടലാസ്'],
  'sort.correctSeparate': ['Keep it separate', 'अलग रखें', 'വേർതിരിച്ച് സൂക്ഷിക്കുക'],
  'sort.correctionThanks': [
    'Thank you — that photo is now in the training set for {label}.',
    'धन्यवाद — वह फ़ोटो अब {label} के प्रशिक्षण सेट में है।',
    'നന്ദി — ആ ഫോട്ടോ ഇപ്പോൾ {label} ന്റെ പരിശീലന ശേഖരത്തിലുണ്ട്.',
  ],
  'sort.rearm': [
    'Remove the item; the camera arms itself for the next one.',
    'चीज़ हटा दें; कैमरा अगली के लिए खुद तैयार हो जाता है।',
    'വസ്തു എടുത്തുമാറ്റുക; ക്യാമറ അടുത്തതിനായി സ്വയം തയ്യാറാകും.',
  ],
  'sort.armed': [
    'Camera armed. Show the next item when you are ready.',
    'कैमरा तैयार है। जब चाहें अगली चीज़ दिखाएँ।',
    'ക്യാമറ തയ്യാറാണ്. തയ്യാറാകുമ്പോൾ അടുത്ത വസ്തു കാണിക്കുക.',
  ],
  'sort.cameraStopped': [
    'The camera stopped after this item. Start it again for the next one.',
    'इस चीज़ के बाद कैमरा बंद हो गया। अगली के लिए इसे फिर चालू करें।',
    'ഈ വസ്തുവിന് ശേഷം ക്യാമറ നിന്നു. അടുത്തതിനായി വീണ്ടും ഓൺ ചെയ്യുക.',
  ],
  'sort.pressHint': [
    'Hold the item up and press Check the item. Nothing is classified until you do.',
    'चीज़ ऊपर उठाकर “चीज़ जाँचें” दबाएँ। तब तक कुछ पहचाना नहीं जाता।',
    'വസ്തു ഉയർത്തിപ്പിടിച്ച് “വസ്തു പരിശോധിക്കുക” അമർത്തുക. അതുവരെ ഒന്നും തിരിച്ചറിയില്ല.',
  ],
  'sort.warming': [
    'Learning this room so the background is never classified as an item. Hold the item up in a moment.',
    'इस कमरे को सीख रहे हैं ताकि पृष्ठभूमि कभी चीज़ न गिनी जाए। थोड़ी देर में चीज़ दिखाएँ।',
    'പശ്ചാത്തലം ഒരിക്കലും വസ്തുവായി കണക്കാക്കാതിരിക്കാൻ ഈ മുറി പഠിക്കുന്നു. അൽപ്പസമയത്തിന് ശേഷം വസ്തു കാണിക്കുക.',
  ],
  'sort.removeHint': [
    'Take this item away — the camera re-arms by itself.',
    'इस चीज़ को हटा लें — कैमरा खुद तैयार हो जाता है।',
    'ഈ വസ്തു എടുത്തുമാറ്റുക — ക്യാമറ സ്വയം തയ്യാറാകും.',
  ],
  'sort.nothingToSort': [
    'Nothing to sort — this does not look like waste. Show one item, held in your hand is fine.',
    'छाँटने को कुछ नहीं — यह कचरा नहीं लगता। एक चीज़ दिखाएँ, हाथ में पकड़ी हो तो भी ठीक है।',
    'തരംതിരിക്കാൻ ഒന്നുമില്ല — ഇത് മാലിന്യമായി തോന്നുന്നില്ല. ഒരു വസ്തു കാണിക്കുക; കൈയിൽ പിടിച്ചതും ആകാം.',
  ],
  'sort.lookingAt': [
    'Looking at {item}… hold still.', '{item} देख रहे हैं… स्थिर रखें।', '{item} നോക്കുന്നു… അനങ്ങാതെ പിടിക്കുക.',
  ],
  'sort.notSure': [
    'Not sure what this is — hold one item on its own, filling the square, and keep still. A bin needs {percent}% on {frames} frames in a row.',
    'पक्का नहीं कि यह क्या है — एक चीज़ अकेली, चौकोर में भरकर, स्थिर पकड़ें। बिन के लिए लगातार {frames} फ़्रेम पर {percent}% चाहिए।',
    'ഇത് എന്താണെന്ന് ഉറപ്പില്ല — ഒരു വസ്തു മാത്രം, ചതുരത്തിൽ നിറച്ച്, അനങ്ങാതെ പിടിക്കുക. ബിന്നിന് തുടർച്ചയായി {frames} ഫ്രെയിമിൽ {percent}% വേണം.',
  ],
  'sort.waitingSee': [
    'Waiting for the camera to see something.',
    'कैमरे के कुछ देखने का इंतज़ार।',
    'ക്യാമറ എന്തെങ്കിലും കാണുന്നതിനായി കാത്തിരിക്കുന്നു.',
  ],
  'sort.previewOnlyNote': [
    'Preview only — no bin is suggested because the recognition model is not available. A presenter can install it from Setup → Voice & Camera.',
    'सिर्फ़ झलक — कोई बिन नहीं सुझाया, क्योंकि पहचान का मॉडल उपलब्ध नहीं है। प्रस्तुतकर्ता इसे सेटअप → आवाज़ और कैमरा से लगा सकते हैं।',
    'കാഴ്ച മാത്രം — തിരിച്ചറിയൽ മോഡൽ ലഭ്യമല്ലാത്തതിനാൽ ബിൻ നിർദ്ദേശിക്കുന്നില്ല. അവതാരകന് സെറ്റപ്പ് → ശബ്ദവും ക്യാമറയും എന്നതിൽ നിന്ന് ഇൻസ്റ്റാൾ ചെയ്യാം.',
  ],
  'sort.recordSahayak': ['Record that the Gram Sahayak took it', 'दर्ज करें कि ग्राम सहायक ने लिया', 'ഗ്രാം സഹായക് എടുത്തുവെന്ന് രേഖപ്പെടുത്തുക'],
  'sort.recordRecycling': ['Record that the recycling agent took it', 'दर्ज करें कि रीसाइक्लिंग एजेंट ने लिया', 'റീസൈക്ലിംഗ് ഏജന്റ് എടുത്തുവെന്ന് രേഖപ്പെടുത്തുക'],
  'sort.recordBin': ['Record that you put it in the bin', 'दर्ज करें कि आपने इसे बिन में डाला', 'നിങ്ങൾ ഇത് ബിന്നിൽ ഇട്ടുവെന്ന് രേഖപ്പെടുത്തുക'],
  'sort.depositHint': [
    'This is a separate record. A recognition does not prove that the item was placed in a bin.',
    'यह अलग रिकॉर्ड है। पहचान से यह साबित नहीं होता कि चीज़ बिन में डाली गई।',
    'ഇത് പ്രത്യേക രേഖയാണ്. തിരിച്ചറിയൽ വസ്തു ബിന്നിൽ ഇട്ടുവെന്ന് തെളിയിക്കുന്നില്ല.',
  ],
  'sort.note': ['Note (optional)', 'टिप्पणी (वैकल्पिक)', 'കുറിപ്പ് (നിർബന്ധമല്ല)'],
  'sort.notePlaceholder': [
    'e.g. plastic bottle from the kitchen', 'जैसे रसोई की प्लास्टिक बोतल', 'ഉദാ: അടുക്കളയിലെ പ്ലാസ്റ്റിക് കുപ്പി',
  ],
  'sort.confirmReported': ['Confirm reported', 'रिपोर्ट की पुष्टि करें', 'റിപ്പോർട്ട് സ്ഥിരീകരിക്കുക'],
  'sort.confirmHanded': ['Confirm handed over', 'सौंपने की पुष्टि करें', 'കൈമാറ്റം സ്ഥിരീകരിക്കുക'],
  'sort.confirmDeposited': ['Confirm deposited', 'जमा करने की पुष्टि करें', 'നിക്ഷേപം സ്ഥിരീകരിക്കുക'],
  'sort.scanAnother': ['Scan another item', 'दूसरी चीज़ दिखाएँ', 'മറ്റൊരു വസ്തു സ്കാൻ ചെയ്യുക'],
  'sort.contactSahayak': ['Contact Gram Sahayak', 'ग्राम सहायक से संपर्क करें', 'ഗ്രാം സഹായകിനെ സമീപിക്കുക'],

  // --------------------------------------------------- waste: model notices ---
  'sort.modelStatusUnknown': [
    'Model status could not be checked', 'मॉडल की स्थिति जाँची नहीं जा सकी', 'മോഡലിന്റെ സ്ഥിതി പരിശോധിക്കാനായില്ല',
  ],
  'sort.checkingModel': ['Checking the recognition model…', 'पहचान का मॉडल जाँचा जा रहा है…', 'തിരിച്ചറിയൽ മോഡൽ പരിശോധിക്കുന്നു…'],
  'sort.modelMissing': ['Recognition model is missing', 'पहचान का मॉडल नहीं मिला', 'തിരിച്ചറിയൽ മോഡൽ ഇല്ല'],
  'sort.modelMissingBody': [
    'No waste model is installed, so the camera will not guess. The preview is still available. A presenter can install it from Setup → Voice & Camera.',
    'कोई कचरा मॉडल नहीं लगा है, इसलिए कैमरा अंदाज़ा नहीं लगाएगा। झलक फिर भी उपलब्ध है। प्रस्तुतकर्ता इसे सेटअप → आवाज़ और कैमरा से लगा सकते हैं।',
    'മാലിന്യ മോഡൽ ഇൻസ്റ്റാൾ ചെയ്തിട്ടില്ല, അതിനാൽ ക്യാമറ ഊഹിക്കില്ല. കാഴ്ച ലഭ്യമാണ്. അവതാരകന് സെറ്റപ്പ് → ശബ്ദവും ക്യാമറയും എന്നതിൽ നിന്ന് ഇൻസ്റ്റാൾ ചെയ്യാം.',
  ],
  'sort.modelCouldNotLoad': ['The model could not be loaded', 'मॉडल लोड नहीं हो सका', 'മോഡൽ ലോഡ് ചെയ്യാനായില്ല'],
  'sort.confidenceDetails': ['Confidence and model details', 'विश्वास और मॉडल की जानकारी', 'വിശ്വാസ്യതയും മോഡൽ വിവരങ്ങളും'],
  'sort.howItWorks': ['How it works', 'यह कैसे काम करता है', 'ഇത് എങ്ങനെ പ്രവർത്തിക്കുന്നു'],
  'sort.safetyNote': [
    'The camera recognises waste; it does not identify people, measure weight, or prove that anything was placed in a bin. The bins have indicator LEDs only, so nothing here measures how full one is.',
    'कैमरा कचरा पहचानता है; यह लोगों को नहीं पहचानता, वज़न नहीं नापता, और यह साबित नहीं करता कि कुछ बिन में डाला गया। बिनों में सिर्फ़ संकेत LED हैं, इसलिए यहाँ कोई बिन कितना भरा है, यह नहीं नापा जाता।',
    'ക്യാമറ മാലിന്യം തിരിച്ചറിയുന്നു; ആളുകളെ തിരിച്ചറിയുന്നില്ല, ഭാരം അളക്കുന്നില്ല, ബിന്നിൽ എന്തെങ്കിലും ഇട്ടുവെന്ന് തെളിയിക്കുന്നുമില്ല. ബിന്നുകളിൽ സൂചന LED-കൾ മാത്രമാണ്; അതിനാൽ ബിൻ എത്ര നിറഞ്ഞുവെന്ന് ഇവിടെ അളക്കുന്നില്ല.',
  ],

  // ------------------------------------------------------------- Sara's panel ---
  'panel.noSpeech': [
    'No speech was detected. Press Start Speaking again and speak clearly.',
    'कोई आवाज़ नहीं मिली। फिर से “बोलना शुरू करें” दबाएँ और साफ़ बोलें।',
    'സംസാരം കേട്ടില്ല. വീണ്ടും “സംസാരിക്കാൻ തുടങ്ങുക” അമർത്തി വ്യക്തമായി സംസാരിക്കുക.',
  ],
  'panel.serviceDown': [
    'The village service did not answer. No command was sent. Is the laptop backend running?',
    'गाँव की सेवा ने जवाब नहीं दिया। कोई आदेश नहीं भेजा गया। क्या लैपटॉप पर बैकएंड चल रहा है?',
    'ഗ്രാമ സേവനം മറുപടി നൽകിയില്ല. ഒരു നിർദ്ദേശവും അയച്ചിട്ടില്ല. ലാപ്ടോപ്പിൽ ബാക്ക്എൻഡ് പ്രവർത്തിക്കുന്നുണ്ടോ?',
  ],
  'panel.micFailed': [
    'The microphone could not start.',
    'माइक्रोफ़ोन शुरू नहीं हो सका।',
    'മൈക്രോഫോൺ തുടങ്ങാനായില്ല.',
  ],
  'panel.onlyAnswers': [
    'That one does not move anything. It only answers.',
    'यह कुछ नहीं बदलता, सिर्फ़ जवाब देता है।',
    'ഇത് ഒന്നും മാറ്റുന്നില്ല; മറുപടി മാത്രം നൽകുന്നു.',
  ],
  'panel.notSupported': [
    'That command is not supported here. Nothing was sent.',
    'यह आदेश यहाँ समर्थित नहीं है। कुछ नहीं भेजा गया।',
    'ഈ നിർദ്ദേശം ഇവിടെ പിന്തുണയ്ക്കുന്നില്ല. ഒന്നും അയച്ചിട്ടില്ല.',
  ],
  'panel.alreadyOff': ['The lights are already off.', 'रोशनी पहले से बंद है।', 'വിളക്കുകൾ ഇതിനകം അണഞ്ഞിരിക്കുന്നു.'],
  'panel.alreadyOn': ['The lights are already on.', 'रोशनी पहले से जल रही है।', 'വിളക്കുകൾ ഇതിനകം കത്തുന്നു.'],
  'panel.cannotReach': [
    'I can’t reach the village controller. Please check its connection.',
    'मैं गाँव के कंट्रोलर तक नहीं पहुँच पा रही हूँ। कृपया उसका कनेक्शन जाँचें।',
    'എനിക്ക് ഗ്രാമ കൺട്രോളറിൽ എത്താനാകുന്നില്ല. അതിന്റെ ബന്ധം പരിശോധിക്കുക.',
  ],
  'panel.sending': [
    'Command understood. Sending it to the village controller.',
    'आदेश समझ गया। गाँव के कंट्रोलर को भेजा जा रहा है।',
    'നിർദ്ദേശം മനസ്സിലായി. ഗ്രാമ കൺട്രോളറിലേക്ക് അയക്കുന്നു.',
  ],
  // ------------------------------------------------------- refusal reasons ---
  // The controller answers a refusal with a code and an English sentence.  The
  // visitor's panel used to show that English sentence under a Malayalam
  // heading (reported 2026-11-18), so the codes a visitor can actually meet are
  // translated here.  An unknown code falls back to `panel.refused` and the
  // raw reason stays visible as the presenter's detail — `reasonKey` in
  // `VoicePanel` is the one place that decides.
  'reason.IRRIGATION_BLOCKED_SOIL_WET': [
    'The soil is already wet enough, so there is nothing to water.',
    'मिट्टी पहले से काफ़ी गीली है, इसलिए पानी देने की ज़रूरत नहीं।',
    'മണ്ണ് മതിയായി നനഞ്ഞിരിക്കുന്നു, അതിനാൽ നനയ്ക്കേണ്ടതില്ല.',
  ],
  'reason.IRRIGATION_BLOCKED_WATER_LOW': [
    'The tank is low, so the pump is not started.',
    'टंकी में पानी कम है, इसलिए पंप शुरू नहीं होगा।',
    'ടാങ്കിൽ വെള്ളം കുറവാണ്, അതിനാൽ പമ്പ് തുടങ്ങില്ല.',
  ],
  'reason.IRRIGATION_BLOCKED_WATER_UNKNOWN': [
    'The tank has no usable reading, so watering is held.',
    'टंकी की कोई भरोसेमंद रीडिंग नहीं है, इसलिए सिंचाई रोकी गई है।',
    'ടാങ്കിന്റെ വായന വിശ്വസനീയമല്ല, അതിനാൽ നനയ്ക്കൽ നിർത്തിവച്ചിരിക്കുന്നു.',
  ],
  'reason.IRRIGATION_BLOCKED_SOIL_UNCALIBRATED': [
    'The soil probe is not calibrated yet, so watering is held.',
    'मिट्टी की जाँच अभी कैलिब्रेट नहीं है, इसलिए सिंचाई रोकी गई है।',
    'മണ്ണ് പരിശോധന ഇപ്പോൾ കാലിബ്രേറ്റ് ചെയ്തിട്ടില്ല, അതിനാൽ നനയ്ക്കൽ നിർത്തിവച്ചിരിക്കുന്നു.',
  ],
  'reason.IRRIGATION_BLOCKED_SENSOR_INVALID': [
    'A sensor reading is not current, so watering is held.',
    'किसी सेंसर की रीडिंग पुरानी है, इसलिए सिंचाई रोकी गई है।',
    'ഒരു സെൻസർ വായന പഴയതാണ്, അതിനാൽ നനയ്ക്കൽ നിർത്തിവച്ചിരിക്കുന്നു.',
  ],
  'reason.IRRIGATION_BLOCKED_PUMP_DISABLED': [
    'Irrigation is switched off in the settings.',
    'सेटिंग्स में सिंचाई बंद है।',
    'ക്രമീകരണങ്ങളിൽ നനയ്ക്കൽ ഓഫാണ്.',
  ],
  'reason.IRRIGATION_BLOCKED_ALREADY_ACTIVE': [
    'Watering is already running.',
    'सिंचाई पहले से चल रही है।',
    'നനയ്ക്കൽ ഇപ്പോൾത്തന്നെ നടക്കുന്നു.',
  ],
  'reason.IRRIGATION_BLOCKED_COOLDOWN': [
    'A short waiting period is still running, so watering must wait.',
    'अभी थोड़ा इंतज़ार बाकी है, इसलिए सिंचाई बाद में होगी।',
    'ഇനിയും കുറച്ച് കാത്തിരിക്കണം, അതിനാൽ നനയ്ക്കൽ പിന്നീട്.',
  ],
  'reason.IRRIGATION_BLOCKED_LOCKOUT': [
    'Watering stopped several times without the soil getting wetter, so it is locked for now.',
    'मिट्टी गीली न होने पर सिंचाई कई बार रुकी, इसलिए यह अभी बंद है।',
    'മണ്ണ് നനയാത്തതിനാൽ നനയ്ക്കൽ പലതവണ നിന്നു, അതിനാൽ ഇപ്പോൾ ഇത് നിർത്തിയിരിക്കുന്നു.',
  ],
  'reason.IRRIGATION_BLOCKED_BOOT_GUARD': [
    'The controller has just started and is still settling.',
    'कंट्रोलर अभी शुरू हुआ है और स्थिर हो रहा है।',
    'കൺട്രോളർ ഇപ്പോൾ തുടങ്ങിയതാണ്, ഇപ്പോഴും സ്ഥിരമാകുന്നു.',
  ],
  'reason.LIGHTS_NOT_INSTALLED': [
    'The streetlights are not fitted on this board.',
    'इस बोर्ड पर स्ट्रीट लाइट लगी नहीं है।',
    'ഈ ബോർഡിൽ തെരുവുവിളക്കുകൾ ഘടിപ്പിച്ചിട്ടില്ല.',
  ],
  'reason.PUMP_MANUAL_ACTIVE': [
    'The pump is on the manual switch. Set it back to Auto to water by the rules.',
    'पंप मैनुअल स्विच पर है। नियम से सिंचाई के लिए इसे ऑटो पर लौटाएँ।',
    'പമ്പ് മാനുവൽ സ്വിച്ചിലാണ്. നിയമപ്രകാരം നനയ്ക്കാൻ അത് ഓട്ടോയിലേക്ക് തിരികെ വയ്ക്കുക.',
  ],
  'reason.PUMP_MANUAL_WATER_LOW': [
    'The tank is at its minimum, so the pump stays off.',
    'टंकी अपने न्यूनतम स्तर पर है, इसलिए पंप बंद रहेगा।',
    'ടാങ്ക് ഏറ്റവും കുറഞ്ഞ നിലയിലാണ്, അതിനാൽ പമ്പ് ഓഫായി തുടരും.',
  ],
  'reason.COMMAND_INVALID': [
    'That command was not recognised.',
    'वह कमांड समझ नहीं आया।',
    'ആ കമാൻഡ് മനസ്സിലായില്ല.',
  ],
  // A demo answer must never imply the physical model moved, so a translated
  // refusal keeps the same marker the simulator puts on its own sentence.
  'panel.simulatedPrefix': ['Simulated:', 'सिमुलेटेड:', 'സിമുലേറ്റഡ്:'],
  'panel.alreadyLightsAuto': [
    'The streetlights already follow the light sensor.',
    'स्ट्रीट लाइट पहले से रोशनी सेंसर के अनुसार चल रही हैं।',
    'തെരുവുവിളക്കുകൾ ഇപ്പോൾത്തന്നെ പ്രകാശ സെൻസർ അനുസരിച്ച് പ്രവർത്തിക്കുന്നു.',
  ],
  'panel.alreadyPumpAuto': [
    'The pump is already in automatic mode — the readings decide.',
    'पंप पहले से ऑटो मोड में है — रीडिंग ही तय करती है।',
    'പമ്പ് ഇപ്പോൾത്തന്നെ ഓട്ടോ മോഡിലാണ് — വായനകളാണ് തീരുമാനിക്കുന്നത്.',
  ],
  'panel.alreadyPumpOn': [
    'The pump is already on by hand.',
    'पंप पहले से हाथ से चालू है।',
    'പമ്പ് ഇപ്പോൾത്തന്നെ കൈകൊണ്ട് ഓണാണ്.',
  ],
  'panel.alreadyPumpOff': [
    'The pump is already off.',
    'पंप पहले से बंद है।',
    'പമ്പ് ഇപ്പോൾത്തന്നെ ഓഫാണ്.',
  ],
  'panel.refused': [
    'The controller received the command and refused it. Nothing changed.',
    'कंट्रोलर को आदेश मिला और उसने मना कर दिया। कुछ नहीं बदला।',
    'കൺട്രോളർ നിർദ്ദേശം സ്വീകരിച്ച് നിരസിച്ചു. ഒന്നും മാറിയില്ല.',
  ],
  'panel.unconfirmed': [
    'The controller did not confirm the action. Do not assume anything happened.',
    'कंट्रोलर ने काम की पुष्टि नहीं की। यह न मानें कि कुछ हुआ है।',
    'കൺട്രോളർ പ്രവർത്തനം സ്ഥിരീകരിച്ചില്ല. എന്തെങ്കിലും സംഭവിച്ചു എന്ന് കരുതരുത്.',
  ],
  'panel.duplicate': [
    'This command was already processed. The original decision stands.',
    'यह आदेश पहले ही संसाधित हो चुका है। पहला फ़ैसला ही लागू है।',
    'ഈ നിർദ്ദേശം മുൻപേ പ്രോസസ്സ് ചെയ്തു. ആദ്യ തീരുമാനം തുടരും.',
  ],
  'panel.confirmed': [
    'The controller confirmed the command.',
    'कंट्रोलर ने आदेश की पुष्टि की।',
    'കൺട്രോളർ നിർദ്ദേശം സ്ഥിരീകരിച്ചു.',
  ],
  'panel.noVoiceForLanguage': [
    'This computer has no voice for {language}, so the reply is shown as text.',
    'इस कंप्यूटर पर {language} की आवाज़ नहीं है, इसलिए जवाब लिखकर दिखाया गया है।',
    'ഈ കമ്പ്യൂട്ടറിൽ {language} ശബ്ദമില്ല, അതിനാൽ മറുപടി എഴുത്തായി കാണിക്കുന്നു.',
  ],
  'panel.replyNotRead': [
    'The reply could not be read aloud. The text above is the full reply.',
    'जवाब पढ़कर सुनाया नहीं जा सका। ऊपर लिखा पूरा जवाब है।',
    'മറുപടി വായിച്ച് കേൾപ്പിക്കാനായില്ല. മുകളിലുള്ളതാണ് പൂർണ മറുപടി.',
  ],
  'panel.silent': [
    'I did not hear anything. Please speak a little louder, or type your request.',
    'मुझे कुछ सुनाई नहीं दिया। कृपया थोड़ा ऊँचा बोलें, या अपना अनुरोध लिखें।',
    'ഒന്നും കേട്ടില്ല. അൽപ്പം ഉച്ചത്തിൽ പറയുക, അല്ലെങ്കിൽ നിങ്ങളുടെ അഭ്യർത്ഥന എഴുതുക.',
  ],
  'panel.notHeard': [
    'I did not hear that clearly. Please say it again a little slower, or type it.',
    'मैंने वह साफ़ नहीं सुना। कृपया थोड़ा धीमे फिर कहें, या लिखें।',
    'അത് വ്യക്തമായി കേട്ടില്ല. അൽപ്പം പതുക്കെ വീണ്ടും പറയുക, അല്ലെങ്കിൽ എഴുതുക.',
  ],
  'panel.notLanguageScript': [
    'The speech model did not hear {language} clearly — that is not {language} script. Say it again a little slower, or type it.',
    'बोलने का मॉडल {language} साफ़ नहीं सुन पाया — वह {language} लिपि नहीं है। थोड़ा धीरे फिर कहें, या लिखें।',
    'സംസാര മോഡലിന് {language} വ്യക്തമായി കേട്ടില്ല — അത് {language} ലിപിയല്ല. അൽപ്പം പതുക്കെ വീണ്ടും പറയുക, അല്ലെങ്കിൽ എഴുതുക.',
  ],

  'panel.noRecording': [
    'This browser cannot record audio, so spoken commands are unavailable here. Use the buttons on the cards instead.',
    'यह ब्राउज़र आवाज़ रिकॉर्ड नहीं कर सकता, इसलिए यहाँ बोलकर आदेश नहीं दे सकते। कार्ड के बटन इस्तेमाल करें।',
    'ഈ ബ്രൗസറിന് ശബ്ദം റെക്കോർഡ് ചെയ്യാനാവില്ല, അതിനാൽ ഇവിടെ സംസാരിച്ച് നിർദ്ദേശം നൽകാനാവില്ല. കാർഡുകളിലെ ബട്ടണുകൾ ഉപയോഗിക്കുക.',
  ],
  'panel.speechUnavailable': [
    'The speech service is not available on this laptop, so spoken commands cannot work here.',
    'इस लैपटॉप पर बोलने की सेवा उपलब्ध नहीं है, इसलिए यहाँ बोलकर आदेश नहीं चलेंगे।',
    'ഈ ലാപ്ടോപ്പിൽ സംസാര സേവനം ലഭ്യമല്ല, അതിനാൽ ഇവിടെ സംസാരിച്ച് നിർദ്ദേശം നൽകാനാവില്ല.',
  ],
  'panel.speechUnknown': [
    'The speech service could not be checked, so recording is paused. The cards still work.',
    'बोलने की सेवा जाँची नहीं जा सकी, इसलिए रिकॉर्डिंग रुकी है। कार्ड अभी भी काम करते हैं।',
    'സംസാര സേവനം പരിശോധിക്കാനായില്ല, അതിനാൽ റെക്കോർഡിംഗ് നിർത്തിയിരിക്കുന്നു. കാർഡുകൾ പ്രവർത്തിക്കും.',
  ],
  'panel.offlineNote': [
    'The board is not answering. You can still speak, but nothing will move until it reconnects.',
    'बोर्ड जवाब नहीं दे रहा। आप बोल सकते हैं, पर दोबारा जुड़ने तक कुछ नहीं चलेगा।',
    'ബോർഡ് മറുപടി നൽകുന്നില്ല. നിങ്ങൾക്ക് സംസാരിക്കാം, പക്ഷേ വീണ്ടും ബന്ധിപ്പിക്കുന്നതുവരെ ഒന്നും പ്രവർത്തിക്കില്ല.',
  ],
  'panel.waitingBoard': [
    'Waiting for the first reading from the board…',
    'बोर्ड से पहली रीडिंग का इंतज़ार…',
    'ബോർഡിൽ നിന്നുള്ള ആദ്യ വായനയ്ക്കായി കാത്തിരിക്കുന്നു…',
  ],
  'panel.close': ['Close voice panel', 'आवाज़ पैनल बंद करें', 'ശബ്ദ പാനൽ അടയ്ക്കുക'],

  'bins.title': ['Bin LEDs', 'बिन LED', 'ബിൻ LED-കൾ'],
  'bins.organic': ['Organic', 'जैविक', 'ജൈവം'],
  'bins.plastic': ['Plastic', 'प्लास्टिक', 'പ്ലാസ്റ്റിക്'],
  'bins.paper': ['Paper', 'कागज़', 'കടലാസ്'],
  'bins.on': ['on', 'चालू', 'ഓൺ'],
  'bins.off': ['off', 'बंद', 'ഓഫ്'],
  'bins.none': [
    'No bin LED is lit — nothing has been put in a bin yet.',
    'कोई बिन LED नहीं जली — अभी कुछ भी बिन में नहीं डाला गया।',
    'ബിൻ LED കത്തുന്നില്ല — ഇതുവരെ ഒന്നും ബിന്നിൽ ഇട്ടിട്ടില്ല.',
  ],

  'sort.focusEmpty': [
    'Show one item to the camera — held in your hand is fine. An empty scene is optional: set one only if the camera looks at a fixed, empty table, and then only the object that appears is classified.',
    'कैमरे को एक चीज़ दिखाएँ — हाथ में पकड़ी हो तो भी ठीक है। खाली दृश्य ज़रूरी नहीं: इसे तभी सेट करें जब कैमरा एक स्थिर, खाली मेज़ की ओर हो; तब सिर्फ़ वही चीज़ पहचानी जाती है जो सामने आए।',
    'ക്യാമറയ്ക്ക് ഒരു വസ്തു കാണിക്കുക — കൈയിൽ പിടിച്ചതും ആകാം. കാലി കാഴ്ച നിർബന്ധമല്ല: ക്യാമറ ഒരു സ്ഥിരമായ ഒഴിഞ്ഞ മേശയിലേക്കാണെങ്കിൽ മാത്രം അത് ക്രമീകരിക്കുക; അപ്പോൾ പ്രത്യക്ഷപ്പെടുന്ന വസ്തു മാത്രം തിരിച്ചറിയും.',
  ],
  'sort.backgrounds': [
    '{count} of {max} backgrounds stored on this device. The last set remains until you clear it; {next}',
    'इस डिवाइस पर {count} / {max} पृष्ठभूमियाँ सहेजी हैं। हटाने तक पिछली बनी रहती है; {next}',
    'ഈ ഉപകരണത്തിൽ {count} / {max} പശ്ചാത്തലങ്ങൾ സൂക്ഷിച്ചിരിക്കുന്നു. നീക്കുന്നതുവരെ അവസാനത്തേത് തുടരും; {next}',
  ],
  'sort.bgReplaceOldest': [
    'adding another replaces the oldest.', 'और जोड़ने पर सबसे पुरानी हट जाएगी।', 'മറ്റൊന്ന് ചേർത്താൽ ഏറ്റവും പഴയത് മാറും.',
  ],
  'sort.bgAddAnother': [
    'add another for a door or lights that change.',
    'दरवाज़े या बदलती रोशनी के लिए एक और जोड़ें।',
    'വാതിലിനോ മാറുന്ന വെളിച്ചത്തിനോ വേണ്ടി മറ്റൊന്ന് ചേർക്കുക.',
  ],

  // ---------------------------------------------------------- the pictures ---
  'picture.solar': ['Solar panel and its LED', 'सोलर पैनल और उसकी LED', 'സോളാർ പാനലും അതിന്റെ LED-യും'],
  'picture.wind': ['Windmill', 'पवनचक्की', 'കാറ്റാടി'],
  'picture.windOff': ['Windmill, not fitted', 'पवनचक्की, लगी नहीं है', 'കാറ്റാടി, ഘടിപ്പിച്ചിട്ടില്ല'],
  'picture.plant': ['Potted plant', 'गमले का पौधा', 'ചട്ടിയിലെ ചെടി'],
  'picture.tank': ['Rain water tank', 'बारिश के पानी का टैंक', 'മഴവെള്ള ടാങ്ക്'],
  'picture.lamp': ['Streetlight', 'स्ट्रीट लाइट', 'തെരുവുവിളക്ക്'],
  'picture.bins': [
    'A camera looking at the three waste bins',
    'तीन कचरा बिनों को देखता कैमरा',
    'മൂന്ന് മാലിന്യ ബിന്നുകളിലേക്ക് നോക്കുന്ന ക്യാമറ',
  ],
} as const;

export type MessageKey = keyof typeof MESSAGES;
