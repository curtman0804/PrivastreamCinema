import { runBU23IOGuideHealthRecheck } from '../../src/liveAddonBackgroundHealth';
import { publishBU23JBGuideCounts } from '../../src/liveAddonGuideCounts';
import { BU23HZ_ADDON_EVENT, loadBU23HZAddonHealth, isAddonConfirmedDown, type BU23HZAddonRegistry } from '../../src/liveAddonGuideStatus';
import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  findNodeHandle,
  DeviceEventEmitter,
  useTVEventHandler,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PrivastreamLiveTVStationList from '../../src/components/PrivastreamLiveTVStationList';
import PrivastreamLiveTVGuide from '../../src/components/PrivastreamLiveTVGuide';
import PrivastreamCategoryRow from '../../src/components/PrivastreamCategoryRow';
import { useFocusEffect, useRouter } from 'expo-router';

import { api, ContentItem } from '../../src/api/client';
import W121zEpg161bStorage from '../../src/utils/mmkvStorage';
import { loadLiveHealth, temporarilyHidden } from '../../src/liveChannelHealthBridge';
import type { FeedHealthRegistry } from '../../src/liveChannelHealth';
import { useContentStore } from '../../src/store/contentStore';
import {
  v176iRegisterGetter,
} from '../../src/components/ContentCard';

// W121ZEPG161B - conservative warm-start guide cache.
// The authoritative live inventory and EPG refresh remain unchanged.
const W161B_CACHE_KEY = 'w121zepg161b:guide:v1';
// W121ZLIVE175A: preserve only prior NexoTV rows from a successful, fully
// completed inventory. Never renew this recovery snapshot on rate-limit pages.
const W175A_NEXO_GOOD_KEY = 'w121zlive175a:nexo:good:v1';
const W175A_NEXO_GOOD_AGE_MS = 24 * 60 * 60 * 1000;
const W175A_NEXO_GOOD_MAX_BYTES = 2 * 1024 * 1024;
// W121ZEPG161AM: separate, bounded schedule snapshot; channel cache remains compact.
const W161AM_PROGRAM_KEY = 'w121zepg161am:programs:v1';
const W161AM_PROGRAM_AGE_MS = 20 * 60 * 1000;
const W161AM_PROGRAM_MAX_BYTES = 1500 * 1024;
const W161B_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const W161B_MAX_ROWS = 4000;
const W161D_MAX_CACHE_BYTES = 2 * 1024 * 1024;
const w161bScope = (): string | null => {
  const state = useContentStore.getState();
  const uid = String(state.currentUserId || '').trim();
  const addons = Array.isArray(state.addons) ? state.addons : [];
  // Do not accept a partial addon inventory while authentication/addons load.
  if (!uid || state.isLoadingAddons || addons.length === 0) return null;
  const ids = addons.map((addon: any) =>
    String(addon?.id || addon?.manifestUrl || addon?.url || '').trim()
  );
  if (ids.some((id) => !id)) return null;
  return JSON.stringify([uid, ids.sort()]);
};

const SLOT_MS = 30 * 60 * 1000;
const SLOT_WIDTH = 210;
// V788R2_EIGHT_HOUR_GUIDE
const SLOT_COUNT = 16;
const CHANNEL_WIDTH = 340;
// V788R2_COMPACT_GUIDE_ROWS
// V788T7B_COMPACT_GUIDE_ROWS
const ROW_HEIGHT = 52;

type GuideProgram = {
  id?: string;
  title?: string;
  startTime: string;
  endTime: string;
  overview?: string;
  thumbnail?: string;
};

type GuideChannel = {
  key: string;
  item: ContentItem;
  name: string;
  logo?: string;
  sourceName?: string;
  addonId?: string;
  programs: GuideProgram[];
};

// W121ZLIVE172D -- artwork from exact brand names in the audited Free-TV source.
// Only source entries with one unambiguous HTTPS raster logo are included.
// Overrides provider letter-art at the native guide PRESENTATION boundary only.
// Channel source, IDs, streams, EPG programs and saved inventory are unchanged.
const w172dBrandLogos: Readonly<Record<string,string>> = {"1 1 ukraina":"https://i.imgur.com/FlG7npq.png","10 bold":"https://i.imgur.com/2cq3fY1.png","10 hd":"https://i.imgur.com/ZjKvXPn.png","10 peach":"https://i.imgur.com/NlZLut8.png","10 shake":"https://i.imgur.com/OXtIkOn.png","111 tv":"https://i.imgur.com/4jY8yAI.png","12 tv parma":"https://i.imgur.com/xnUgx6b.png","13 cultura":"https://i.imgur.com/49QkKWv.png","13 entretenci n":"https://i.imgur.com/1vTno0m.png","13 kids":"https://i.imgur.com/m6y9AMe.png","13 prime":"https://i.imgur.com/YwDFNxs.png","13 realities":"https://i.imgur.com/p1Qpljw.png","13 teleseries":"https://i.imgur.com/aJMBnse.png","16 anni e incinta pluto tv":"https://i.imgur.com/4BHrbP7.png","16tv":"https://i.imgur.com/7ZPYJJ0.jpg","1mus":"https://i.imgur.com/PozF9MT.png","20 mediaset":"https://i.imgur.com/It13jwX.png","24 1080p":"https://i.imgur.com/tpqsFzm.png","24 720p":"https://i.imgur.com/tpqsFzm.png","24 horas":"https://i.imgur.com/0rF6Kub.png","24 kanal":"https://pbs.twimg.com/profile_images/1498285886714298374/EMSJzC-0_400x400.jpg","27 twentyseven":"https://i.imgur.com/y2PdPCK.png","3 24":"https://raw.githubusercontent.com/tv-logo/tv-logos/refs/heads/main/countries/spain/3-24-es.png","3sat":"https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/3sat_2019.svg/500px-3sat_2019.svg.png","4 you tv":"https://i.imgur.com/NN0cSbz.png","5 kanal":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Logo_5_Channel.svg/500px-Logo_5_Channel.svg.png","6ter":"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Logo_6ter_2016.svg/500px-Logo_6ter_2016.svg.png","7 regi n de murcia":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/La_7_logo.svg/120px-La_7_logo.svg.png","70s cinema":"https://i.imgur.com/wk9Baz9.png","7flix":"https://i.imgur.com/6iIYCyC.png","7mate":"https://i.imgur.com/zpr12HP.png","7two":"https://i.imgur.com/6pyIg02.png","8 kanal vitebsk":"https://i.imgur.com/tjwBSTF.jpg","80s rewind":"https://i.imgur.com/0FaLAhK.png","90s throwback":"https://i.imgur.com/sI1o3uK.png","91nrg":"https://i.imgur.com/g1pCRRG.png","98fm":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/98FM_2022.svg/1920px-98FM_2022.svg.png","9gem":"https://i.imgur.com/sWmE1kq.png","9life":"https://i.imgur.com/ZCUiqlL.png","9rush":"https://upload.wikimedia.org/wikipedia/en/c/c2/Logo_of_9RUSH.png","a2 cnn albania":"https://i.imgur.com/TgO3Lzi.png","aaj tak":"https://upload.wikimedia.org/wikipedia/commons/2/28/Aaj_tak_logo.png","ab channel":"https://i.imgur.com/k8EPLB9.png","abc kids":"https://i.imgur.com/GWDRR1t.png","abc me":"https://i.imgur.com/gBh54wY.png","abc news albania":"https://i.imgur.com/aObcudw.png","abc news au":"https://i.imgur.com/BrW7gk8.png","abc news live":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-states/abc-news-live-hz-us.png","abp ananda":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/ABP_Ananda_logo.svg/500px-ABP_Ananda_logo.svg.png","abp news":"https://i.imgur.com/DKHUFVQ.png","abu dhabi sports 1":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Abu_Dhabi_Sports_logo_2023.svg/1920px-Abu_Dhabi_Sports_logo_2023.svg.png","abu dhabi sports 2":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Abu_Dhabi_Sports_logo_2023.svg/1920px-Abu_Dhabi_Sports_logo_2023.svg.png","abu dhabi tv":"https://i.imgur.com/7cNke07.png","accuweather now":"https://i.imgur.com/M8wbVYK.png","acheloos":"https://i.imgur.com/5SVMxcu.png","action24":"https://i.imgur.com/Zi1YohT.png","ada tv":"https://i.imgur.com/LPQfdz2.png","adn noticias":"https://pbs.twimg.com/profile_images/1968512728059850752/KUWD445m_200x200.jpg","adtv":"https://i.imgur.com/FvlcU3z.png","advocate broadcasting network":"https://i.imgur.com/eZrhTam.png","affare fatto pluto tv":"https://i.imgur.com/BuGkGsL.png","africanews":"https://i.imgur.com/xocvePC.png","aghapy tv":"https://upload.wikimedia.org/wikipedia/en/e/eb/AghapyTV.jpg","agrobrasil tv":"https://upload.wikimedia.org/wikipedia/pt/6/60/Logo_AgroBrasilTV.jpg","aguacate tv":"https://intervenhosting.net/imagenes/aguacatetv.jpg","al aan tv":"https://upload.wikimedia.org/wikipedia/commons/7/76/Al_Aan_TV_new_Logo.png","al alam news network":"https://i.imgur.com/UbD0Ndr.png","al arabiya":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Al-Arabiya_new_logo.svg/500px-Al-Arabiya_new_logo.svg.png","al arabiya business":"https://i.imgur.com/eEV4r6J.jpg","al araby tv":"https://i.imgur.com/YMqWEe4.png","al ekhbariya":"https://i.imgur.com/WcRlHQm.png","al ghad plus":"https://upload.wikimedia.org/wikipedia/commons/0/06/AlGhad_TV.png","al ghad tv":"https://upload.wikimedia.org/wikipedia/commons/0/06/AlGhad_TV.png","al hurra":"https://i.imgur.com/0izeu5z.png","al hurra iraq":"https://i.imgur.com/mXBZEQP.png","al ingi":"https://i.imgur.com/n170HMm.png","al iraqiya":"https://i.imgur.com/imdV6kL.png","al jazeera":"https://i.imgur.com/BB93NQP.png","al jazeera 2":"https://i.imgur.com/BB93NQP.png","al jazeera balkans":"https://i.imgur.com/Z1FB6wl.png","al jazeera documentary":"https://upload.wikimedia.org/wikipedia/en/e/e6/Al_Jazeera_Doc.png","al jazeera mubasher":"https://upload.wikimedia.org/wikipedia/en/9/90/Al_Jazeera_Mubasher_logo.png","al qahera news":"https://upload.wikimedia.org/wikipedia/ar/b/b0/%D9%82%D9%86%D8%A7%D8%A9_%D8%A7%D9%84%D9%82%D8%A7%D9%87%D8%B1%D8%A9_%D8%A7%D9%84%D8%A5%D8%AE%D8%A8%D8%A7%D8%B1%D9%8A%D8%A9.png","al quran al kareem tv":"https://i.imgur.com/A2fJysM.png","al rafidain":"https://i.imgur.com/D78qG91.png","al rasheed":"https://i.imgur.com/SU9HbXY.png","al rayyan":"https://i.imgur.com/Ts3RjTV.png","al rayyan old tv":"https://i.imgur.com/4qB5iN0.png","al saudiya":"https://i.imgur.com/GRQTndk.png","al saudiya alaan":"https://i.imgur.com/sEOjApe.png","al sharqiya":"https://i.imgur.com/bPYyXNf.png","al sharqiya news":"https://i.imgur.com/P6p17ZY.jpg","al sunnah al nabawiyah tv":"https://i.imgur.com/S6LcTJv.png","alabbassia tv":"https://i.imgur.com/BPyrjO5.png","albkanale music tv":"https://i.imgur.com/JdKxscs.png","alcarria tv":"https://i.imgur.com/zNSuxVZ.jpg","alert":"https://i.imgur.com/xqa87lG.png","alfa":"https://upload.wikimedia.org/wikipedia/fi/9/93/IRR-TV-1.png","alkass four":"https://i.imgur.com/iDL65Wu.png","alkass one":"https://i.imgur.com/10mmlha.png","alkass three":"https://i.imgur.com/d57BdFh.png","alkass two":"https://i.imgur.com/8w61kFX.png","all the k pop":"https://i.imgur.com/tBbTTAx.png","alma tv":"https://i.imgur.com/Y8JiDwN.png","alpauno":"https://i.imgur.com/4QKFtUa.png","alphatv":"https://i.imgur.com/bAVGX0l.png","alpo tv":"https://i.imgur.com/Pr4ixiA.png","alsat m":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Logo_of_Alsat_TV_%282020-%29.svg/500px-Logo_of_Alsat_TV_%282020-%29.svg.png","alto adige tv":"https://i.imgur.com/S2sCFQi.png","am rica":"https://i.imgur.com/Jt7dOQm.png","am terni television":"https://i.imgur.com/XLuIz5j.png","america teve":"https://pbs.twimg.com/profile_images/2067373416173260801/9cUCY5wX_200x200.jpg","andorra tv":"https://upload.wikimedia.org/wikipedia/commons/3/32/Logo_Andorra_Televisi%C3%B3.png","andromeda pluto tv":"https://i.imgur.com/2HFhwX9.png","anime pluto tv":"https://i.imgur.com/rhVF0eC.png","ant1":"https://i.imgur.com/xDdVa9U.png","antena 3":"https://i.imgur.com/j3SP4BS.png","antenna 2 bergamo":"https://i.imgur.com/NfvHIAw.png","antenna 3 massa":"https://i.imgur.com/CHDU86j.png","antenna 3 veneto nord est":"https://i.imgur.com/NiVHLwp.png","antenna sicilia":"https://i.imgur.com/8DOdqsE.png","antenna sud":"https://i.imgur.com/b8y6ImZ.png","antenna sud extra":"https://i.imgur.com/6tBv8VD.png","apostol tv":"https://www.apostoltv.hu/images/header-logo.png","arag n tv":"https://i.imgur.com/8H3Q07b.png","ard alpha":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/ARD_alpha.svg/500px-ARD_alpha.svg.png","argentina 12":"https://i.imgur.com/atGKPhi.png","arirang":"https://i.imgur.com/RuHZ6Dx.png","arirang world":"https://raw.githubusercontent.com/tv-logo/tv-logos/67cfa9368d2d135744732a3aed3baecb3fadcf13/countries/international/arirang-int.png","aristanis supertv":"https://i.imgur.com/v8PlAJO.png","armenia 1":"https://i.imgur.com/HIwJ4lc.png","armenia tv":"https://i.imgur.com/UnoI5uM.png","art tv":"https://i.imgur.com/LyCqQvx.png","arte":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Arte_Logo_2017.svg/250px-Arte_Logo_2017.svg.png","arte belgique":"https://i.imgur.com/w7HzPQh.png","arte network orler":"https://i.imgur.com/DP5y0Er.png","aryen tv":"https://i.imgur.com/qUg7edz.png","as3 sport tv":"https://intervenhosting.net/imagenes/as3sporttv.jpg","asianet news":"https://i.imgur.com/ofntbBS.png","asianet news telugu":"https://i.imgur.com/9wJvDMn.jpeg","asianet suvarna news":"https://i.imgur.com/zRWl97N.jpeg","astra":"https://i.imgur.com/oYRPfZm.png","atg live":"https://i.imgur.com/bPWFXkL.png","atreseries":"https://raw.githubusercontent.com/tv-logo/tv-logos/refs/heads/main/countries/spain/atreseries-es.png","atv noticias":"https://upload.wikimedia.org/wikipedia/commons/f/f4/Atv_noticias_logo.png","aurora arte":"https://i.imgur.com/BoLZ5wG.png","ausbiz":"https://i.imgur.com/8vGGdB0.png","autostop per il cielo pluto tv":"https://i.imgur.com/rpC1qk7.png","avatar pluto tv":"https://i.imgur.com/KDSStnJ.png","azstartv":"https://i.imgur.com/di3XX5L.png","aztv":"https://i.imgur.com/snBMMeH.png","azzurra tv vco":"https://i.imgur.com/mSWw8uW.png","baku tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Baku_TV_%282018%29.png/500px-Baku_TV_%282018%29.png","balaton tv":"https://i.imgur.com/ip8L5Vt.jpg","balti tv":"https://i.imgur.com/S1vEqZp.png","banaadir tv":"https://www.lyngsat.com/logo/tv/bb/banaadir-tv-so.png","basilicata 1 tv":"https://i.imgur.com/VS6CQ88.png","baynounah tv":"https://static.wikia.nocookie.net/logopedia/images/6/60/Baynounah_tv_2023.png","bbc alba":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/BBC_Alba_2021.svg/500px-BBC_Alba_2021.svg.png","bbc asian network":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcasiannet-epg.png","bbc doctor who":"https://i.imgur.com/J2B9FjO.jpg","bbc drama":"https://i.imgur.com/hY1M4hL.jpg","bbc drama pluto tv":"https://i.imgur.com/CrAqXHJ.png","bbc food":"https://i.imgur.com/N3xiz4m.png","bbc four":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/BBC_Four_logo_2021.svg/500px-BBC_Four_logo_2021.svg.png","bbc home":"https://i.imgur.com/Ii8DX1x.png","bbc one":"https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/BBC_One_logo_2021.svg/500px-BBC_One_logo_2021.svg.png","bbc parliament":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/BBC_Parliament_2022.svg/500px-BBC_Parliament_2022.svg.png","bbc radio 1":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd1-epg.png","bbc radio 1xtra":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd1x-epg.png","bbc radio 2":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd2-epg.png","bbc radio 3":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd3-epg.png","bbc radio 4":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd4-epg.png","bbc radio 4 extra":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd4x-epg.png","bbc radio 5 live":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd5l-epg.png","bbc radio 5 sports extra":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd5s-epg.png","bbc radio 6 music":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcrd6-epg.png","bbc scotland":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/BBC_Scotland_2021_%28channel%29.svg/500px-BBC_Scotland_2021_%28channel%29.svg.png","bbc three":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/BBC_Three_2022.svg/500px-BBC_Three_2022.svg.png","bbc two":"https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/BBC_Two_logo_2021.svg/500px-BBC_Two_logo_2021.svg.png","bbc world service":"https://experiencersinternational.github.io/tvsetup/tvg-ico/bbcws-epg.png","be mad":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Be_Mad_TV.svg/500px-Be_Mad_TV.svg.png","bejoy kids":"https://i.imgur.com/zuR9Go5.png","belarus 4 vitebsk":"https://i.imgur.com/TW6Ap71.png","bella e monella tv":"https://i.imgur.com/yZONx5f.png","belros":"https://i.imgur.com/HWqxjGl.png","belsat":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Belsat_%282022%29.svg/960px-Belsat_%282022%29.svg.png","bergamo tv":"https://i.imgur.com/1doR6Vl.png","best tv":"https://i.imgur.com/VA13E3w.png","bfm tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Logo_BFM_TV_%282019%29.png/60px-Logo_BFM_TV_%282019%29.png","bht 1":"https://i.imgur.com/LEwlEEE.png","bio bio tv":"https://i.imgur.com/wrRufts.png","biz tv":"https://i.imgur.com/cbGvXyF.jpg","bizzarro movies":"https://i.imgur.com/EbDLnZB.png","black cinema":"https://i.imgur.com/Zh1QGW9.png","blaze":"https://i.imgur.com/6UcPWP9.png","bloomberg":"https://i.imgur.com/VnCcH73.png","bloomberg television europe":"https://i.imgur.com/OuogLHx.png","bloomberg television us":"https://i.imgur.com/OuogLHx.png","blue sky":"https://i.imgur.com/rzuQslM.png","bnt1":"https://i.imgur.com/7JU9b5j.png","bnt2":"https://i.imgur.com/FyTUr9Q.png","bnt3":"https://i.imgur.com/pPpSJ4u.png","bnt4":"https://i.imgur.com/Lw8b3yu.png","bom channel":"https://i.imgur.com/hISoOK3.png","bom cine":"https://i.imgur.com/cqhofMU.png","bon dia":"https://upload.wikimedia.org/wikipedia/commons/4/4f/Logo_Bon_Dia_TV.png","botflix radioo":"https://i.imgur.com/JBEM8lP.png","botflix tv":"https://i.imgur.com/JBEM8lP.png","br nord":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Logo_BR_Fernsehen_2021.svg/500px-Logo_BR_Fernsehen_2021.svg.png","br s d":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Logo_BR_Fernsehen_2021.svg/500px-Logo_BR_Fernsehen_2021.svg.png","bruzz":"https://www.bruzz.be/themes/custom/drupack/favicons/favicon-32x32.png","bulsho tv":"https://i.imgur.com/7qo4rb7.png","buzzr":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Buzzr_logo.svg/960px-Buzzr_logo.svg.png","byoblu":"https://i.imgur.com/1xaHGtU.png","c31 melbourne":"https://i.imgur.com/dXwkFei.png","cafe tv 24":"https://i.imgur.com/KbcbxFw.png","calabria tv":"https://i.imgur.com/qWirucd.png","calabria uno tv":"https://i.imgur.com/2TK1GQ5.png","camera dei deputati":"https://i.imgur.com/fqGn1k9.png","canal 1":"https://cloudfront-us-east-1.images.arcpublishing.com/gruponacion/2XI5OC6MQZFXXBDGMRRDOZSL2Q.jpg","canal 11":"https://i0.wp.com/directostv.teleame.com/wp-content/uploads/2016/06/Canal-11-Costa-Rica-en-vivo-Online.png","canal 13":"https://i.imgur.com/JIo1HBs.png","canal 2 cdr":"https://i0.wp.com/directostv.teleame.com/wp-content/uploads/2016/06/Canal-2-Costa-Rica-en-vivo-Online.png","canal 26":"https://i.imgur.com/5pAaVih.png","canal 4":"https://i0.wp.com/directostv.teleame.com/wp-content/uploads/2016/06/Canal-4-Costa-Rica-en-vivo-Online.png","canal 4 tenerife":"https://i.imgur.com/Egymir4.png","canal 6":"https://i0.wp.com/directostv.teleame.com/wp-content/uploads/2016/06/Canal-6-Costa-Rica-en-vivo-Online.png","canal 8":"https://platform-static.cdn.mdstrm.com/player/logo/5efe501c21d05a0722152f6d.png","canal extremadura":"https://i.imgur.com/xBeywIA.png","canal macau":"https://i.imgur.com/oFPUZ97.png","canal rtvd 4":"https://static.wikia.nocookie.net/logopedia/images/4/4e/CERTV_4_2015.png","canal sur andaluc a":"https://i.imgur.com/WcVOXPr.png","canale 10":"https://i.imgur.com/KuQcjYV.png","canale 2":"https://i.imgur.com/ETqDkS1.png","canale 21":"https://i.imgur.com/mU6Cq89.png","canale 21 extra":"https://i.imgur.com/cDAsrBl.png","canale 5":"https://i.imgur.com/p6YdiR1.png","canale 58":"https://i.imgur.com/RlFc74C.png","canale 7":"https://i.imgur.com/9cuOLCn.png","canale 74 sicilia":"https://i.imgur.com/18JIVgu.png","canale 8 campania":"https://i.imgur.com/ElAS2WC.png","canale europa":"https://i.imgur.com/Zw2ZIfz.jpg","canale italia":"https://i.imgur.com/QlwLRyh.png","car chase pluto tv":"https://i.imgur.com/F1jXkhK.png","carina tv":"https://i.imgur.com/FMGcm6I.jpg","cartoon network arabic":"https://upload.wikimedia.org/wikipedia/commons/b/bb/Cartoon_Network_Arabic_logo.png","cartoonito":"https://i.imgur.com/oK2DcDJ.png","casa italia 53":"https://i.imgur.com/O4GQVCk.png","casa sanremo tv":"https://i.imgur.com/WL3SFTs.png","case pazzesche pluto tv":"https://i.imgur.com/v8IDWwX.png","castrovillari tv":"https://i.imgur.com/V0kjYNG.png","catfish pluto tv":"https://i.imgur.com/KajHKoP.png","cbbc":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/CBBC_%282023%29.svg/500px-CBBC_%282023%29.svg.png","cbc news":"https://i.imgur.com/1EqQGKS.png","cbc news network":"https://i.imgur.com/SjTdhvJ.png","cbc sport":"https://upload.wikimedia.org/wikipedia/az/0/04/CBC_Sport_TV_loqo.png","cbc toronto":"https://i.imgur.com/H5yEbxf.png","cbeebies":"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/CBeebies_2023.svg/500px-CBeebies_2023.svg.png","cbs news pluto tv":"https://i.imgur.com/ApsK6Eq.png","cctv 1":"https://i.imgur.com/uHU6Vc0.png","cctv 10":"https://i.imgur.com/W8JNs1s.png","cctv 11":"https://i.imgur.com/0MeegZK.png","cctv 12":"https://i.imgur.com/gZNwF1a.png","cctv 13":"https://i.imgur.com/pPO8uJN.png","cctv 14":"https://i.imgur.com/SORrhtE.png","cctv 15":"https://i.imgur.com/V9I1ZyB.png","cctv 17":"https://i.imgur.com/XMsoHut.png","cctv 2":"https://i.imgur.com/6C9JEYt.png","cctv 3":"https://i.imgur.com/Mh1N35D.png","cctv 6":"https://i.imgur.com/SsPN5I3.png","cctv 7":"https://i.imgur.com/GhXlUpM.png","cctv 8":"https://i.imgur.com/Qg1opg9.png","cctv 9":"https://i.imgur.com/Ruyzhu5.png","center tv":"https://i.imgur.com/52JW71Q.png","cgtn":"https://i.imgur.com/fMsJYzl.png","cgtn documentary english":"https://i.imgur.com/JHv0WxM.png","cgtn espa ol":"https://i.imgur.com/fMsJYzl.png","cgtn fran ais":"https://i.imgur.com/fMsJYzl.png","cgtn p":"https://i.imgur.com/fMsJYzl.png","cgtv":"https://i.imgur.com/6rsLtY7.png","chamber tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/2023_Logo_of_the_Chamber_of_Deputies_of_Luxembourg.svg/500px-2023_Logo_of_the_Chamber_of_Deputies_of_Luxembourg.svg.png","channel 5":"https://upload.wikimedia.org/wikipedia/en/thumb/c/cb/Channel_5_%28UK%29_2016.svg/500px-Channel_5_%28UK%29_2016.svg.png","channel news asia":"https://i.imgur.com/xWglicB.png","channels 24":"https://upload.wikimedia.org/wikipedia/en/7/76/Channels_TV.jpg","channels tv":"https://i.imgur.com/O237VLC.png","chch":"https://i.imgur.com/jYSXaga.png","cheddar news":"https://i.imgur.com/tuP9GW8.png","chilevisi n":"https://i.imgur.com/2Pu8yXf.png","chilevisi n deportes":"https://i.imgur.com/eWCXl6a.jpeg","chilevisi n noticias":"https://i.imgur.com/Qh6d0A9.png","christmas pluto tv":"https://i.imgur.com/tQ8lN30.png","cielo":"https://i.imgur.com/cPluF03.png","cine ar":"https://i.imgur.com/RPLyrIC.png","cine34":"https://i.imgur.com/YyldwhI.png","cinema italiano pluto tv":"https://i.imgur.com/drDX5DC.png","cinema segreto":"https://i.imgur.com/pID3ZGx.png","citizen tv":"https://i.imgur.com/DjDaD7h.png","cittaceleste tv":"https://i.imgur.com/9RVriNK.jpeg","city tv":"https://i.imgur.com/BjRTbrU.png","citytv belv ros lip tv ros":"https://citytv.hu/wp-content/uploads/2023/12/cropped-citytv.png","cjb tv":"https://i.imgur.com/MvxdZhX.png","ck 1":"https://i.imgur.com/XiXwr5h.png","clan":"https://i.imgur.com/38xIfQ3.png","class cnbc":"https://i.imgur.com/oAiSU8O.png","classic hits":"https://upload.wikimedia.org/wikipedia/commons/3/31/Classichits2023.jpg","classic movies":"https://i.imgur.com/feWPHep.png","classico rakuten tv":"https://i.imgur.com/ytN6jfl.jpeg","clubbing tv":"https://i.imgur.com/D1IuAqu.jpg","cmc tv":"https://i.imgur.com/Fh2vawT.png","cnbc":"https://i.imgur.com/BTasyOy.png","cnbc europe":"https://d2n0069hmnqmmx.cloudfront.net/epgdata/1.0/newchanlogos/512/512/skychb1088.png","cnbc indonesia":"https://i.imgur.com/bUfeG7Y.png","cnc3":"https://i.imgur.com/1E73l2j.png","cnews":"https://i.imgur.com/UMRGAHx.png","cnn news18":"https://i.imgur.com/K3M8MoK.png","cnn portugal":"https://i.imgur.com/NYH39xs.png","cnn prima news":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/cnn-prima-news-cz.png","com brasil":"https://i.imgur.com/c8ztQnF.png","commedia rakuten tv":"https://i.imgur.com/EKKXdIU.jpg","company tv":"https://i.imgur.com/IbabUDd.png","congress channel 1":"https://i.imgur.com/0dVlvsz.png","congress channel 2":"https://i.imgur.com/htGr996.png","consulenze illegali pluto tv":"https://i.imgur.com/AoOiYJX.png","cool tv":"https://i.imgur.com/2tFrjUz.png","coptic tv":"https://upload.wikimedia.org/wikipedia/en/4/4c/Coptic_news.jpg","corfu":"https://i.imgur.com/dCMqo8w.jpeg","cosmos tv":"https://pbs.twimg.com/profile_images/1904206504753811457/66CbqvH1_200x200.jpg","cpac en":"https://i.imgur.com/AbdFD0S.png","cpac fr":"https://i.imgur.com/AbdFD0S.png","cr nica tv":"https://i.imgur.com/k2Ku8Ib.png","cremona 1":"https://i.imgur.com/a5d0F01.jpg","creta":"https://i.imgur.com/x0qK8IE.png","crime pluto tv":"https://i.imgur.com/WRMGIdb.png","cs film":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/slovakia/cs-film-sk.png","cs history":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/cs-history-cz.png","cs mystery":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/cs-mystery-cz.png","cstar":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Logo_CStar_2016.svg/500px-Logo_CStar_2016.svg.png","ctv news":"https://i.imgur.com/T3oBeiX.png","ctv news channel":"https://upload.wikimedia.org/wikipedia/zh/6/67/CTV_News_logo.png","ctv toronto":"https://i.imgur.com/qOutOWN.png","cuatro":"https://i.imgur.com/zROxNap.png","cucina pluto tv":"https://i.imgur.com/KsOhaOn.png","cusano italia tv":"https://i.imgur.com/9F1sVjZ.png","cusano news 7":"https://i.imgur.com/L49Ie1Q.png","dacwa tv":"https://i.imgur.com/rMqrLzV.png","das erste":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Das_Erste_2014.svg/500px-Das_Erste_2014.svg.png","dd bharati":"https://i.imgur.com/4tfUIEo.png","dd india":"https://i.imgur.com/45uptR8.png","dd kisan":"https://i.imgur.com/x56WJEa.png","dd national":"https://i.imgur.com/MohlE5B.png","dd news":"https://i.imgur.com/znnVCEf.png","dd urdu":"https://i.imgur.com/OiQPS34.png","deejay tv":"https://i.imgur.com/rlaKH6k.png","delfi tv":"https://i.imgur.com/IFoHP5M.png","delta evros":"https://i.imgur.com/PDfSkRF.png","delta tv":"https://i.imgur.com/mfwVXt7.png","deluxe 139":"https://i.imgur.com/kRexw3w.png","deluxe lounge hd":"https://i.imgur.com/LzIsXym.png","deluxe lounge hd pluto tv":"https://i.imgur.com/mTXgaKl.png","deluxe music":"https://i.imgur.com/E65GQN9.png","deluxe music dance by kontor":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Deluxe_Dance_by_Kontor_Logo_2023.svg/500px-Deluxe_Dance_by_Kontor_Logo_2023.svg.png","deluxe music rap":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Deluxe_Rap_Logo_2023.svg/500px-Deluxe_Rap_Logo_2023.svg.png","deportes13":"https://i.imgur.com/GRpxoPf.png","deportv":"https://i.imgur.com/iyYLNRt.png","di tv":"https://i.imgur.com/zApTDWn.png","di tv 80":"https://i.imgur.com/kHxTsJw.png","di tv 92":"https://i.imgur.com/g3SI08H.png","diadora":"https://i.imgur.com/qZzsASl.png","digital tv7 benevento":"https://i.imgur.com/NaQkklP.png","dijlah tarab":"https://i.imgur.com/2SBjjBQ.png","dijlah tv":"https://i.imgur.com/FJEeYiz.png","dikhtv":"https://upload.wikimedia.org/wikipedia/commons/3/34/Dikhtv.png","dion":"https://i.imgur.com/13MverN.png","discovery channel":"https://i.imgur.com/5IxIFJ0.png","divinity":"https://i.imgur.com/o7fvEr6.png","dmax":"https://i.imgur.com/dmEmRX7.png","doctor who pluto tv":"https://i.imgur.com/oewPc3b.png","documentari pluto tv":"https://i.imgur.com/0jYrODf.png","documentari rakuten tv":"https://i.imgur.com/rAHBiO8.jpg","docurama":"https://i.imgur.com/bNg8mze.png","donna shopping tv":"https://i.imgur.com/oLDvx2T.png","donna tv":"https://i.imgur.com/Aa1Abme.png","dr ramasjang":"https://i.imgur.com/YD0z2mN.png","drammatico rakuten tv":"https://i.imgur.com/Nx3JzZK.jpg","drybar comedy":"https://i.imgur.com/EldlmTp.png","dubai one":"https://upload.wikimedia.org/wikipedia/commons/7/7d/Dubaione-logo.png","dubai racing 1":"https://www.lyngsat.com/logo/tv/dd/dubai-racing-ae.png","dubai racing 2":"https://www.lyngsat.com/logo/tv/dd/dubai-racing-ae.png","dubai racing 3":"https://www.lyngsat.com/logo/tv/dd/dubai-racing-ae.png","dubai sports 1":"https://www.lyngsat.com/logo/tv/dd/dubai-sports-ae.png","dubai sports 2":"https://www.lyngsat.com/logo/tv/dd/dubai-sports-ae.png","dubai sports 3":"https://www.lyngsat.com/logo/tv/dd/dubai-sports-ae.png","dubai tv":"https://i.imgur.com/wZMkKF7.png","dubai zaman":"https://www.lyngsat.com/logo/tv/dd/dubai-zaman-ae.png","dublin s q102":"https://upload.wikimedia.org/wikipedia/commons/e/e7/Dublins_Q102_Logo.png","ducktv":"https://i.imgur.com/BKoAJZV.jpeg","due fantagenitori pluto tv":"https://i.imgur.com/HOvLgGK.png","duna tv":"https://i.imgur.com/b4RXacY.png","dw espa ol":"https://i.imgur.com/A1xzjOI.png","e live brescia tv":"https://i.imgur.com/bZ3B7pi.png","east is east pluto tv":"https://i.imgur.com/iPGv82f.png","easy tv canale 190":"https://i.imgur.com/LKrVuRR.jpg","ebs 1":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/EBS_1TV_Logo.svg/500px-EBS_1TV_Logo.svg.png","ebs 2":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/EBS_2TV_Logo.svg/500px-EBS_2TV_Logo.svg.png","ebs english":"https://i.imgur.com/qceaIf7.png","ebs kids":"https://i.imgur.com/62oo8Bx.png","ebs plus 1":"https://i.imgur.com/ImUHRG2.png","ebs plus 2":"https://i.imgur.com/mgFRZFq.png","egnatia":"https://i.imgur.com/zuyYIca.png","el 33":"https://raw.githubusercontent.com/tv-logo/tv-logos/refs/heads/main/countries/spain/el-33-es.png","el nueve":"https://i.imgur.com/EtcVSm4.png","el ping ino tv":"https://i.imgur.com/ohXs2NV.png","el trece":"https://i.imgur.com/ZK7AQFg.png","encuentro":"https://i.imgur.com/IyP2UIx.png","energy":"https://raw.githubusercontent.com/tv-logo/tv-logos/refs/heads/main/countries/spain/energy-es.png","enjoy television":"https://hostux.pics/images/2026/09/11/04_enjoy_television1ad11f59484e0115.png","entella tv":"https://i.imgur.com/1VPXKrW.png","enter film":"https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Enter-FilmUA_%282013%29.png/960px-Enter-FilmUA_%282013%29.png","epirus tv 1":"https://i.imgur.com/QB3aSl1.png","epsilon":"https://i.imgur.com/vUQSDvZ.png","equos tv":"https://i.imgur.com/YwyfNDF.png","equtv":"https://i.imgur.com/x9Wdz7h.png","ert 1":"https://i.imgur.com/WWMe8IY.png","ert 2":"https://i.imgur.com/pcusPFl.png","ert 3":"https://i.imgur.com/KyhzDRm.png","ert cosmos":"https://i.imgur.com/KsMTWYw.png","ert kids":"https://i.imgur.com/XkSR66q.png","ert news":"https://i.imgur.com/saIGLvr.png","ert sports 1":"https://i.imgur.com/gebWmAB.png","ert sports 2":"https://i.imgur.com/gebWmAB.png","ert sports 3":"https://i.imgur.com/gebWmAB.png","ert sports 4":"https://i.imgur.com/gebWmAB.png","espansione tv":"https://i.imgur.com/mm9HKpD.png","esperia tv":"https://patbuweb.com/tivustream/chanlogoz/ita/esperiatv.png","esport3":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Esport3.svg/1280px-Esport3.svg.png","etb1":"https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/ETB1_2022_logo.svg/500px-ETB1_2022_logo.svg.png","etb2":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/ETB2_2022_logo.svg/500px-ETB2_2022_logo.svg.png","etna espresso channel":"https://i.imgur.com/hMUxytZ.png","etv2":"https://i.imgur.com/fUjGHDa.png","euro":"https://i.imgur.com/mHCk05E.png","euro tv":"https://i.imgur.com/HCl5Zbu.png","euronews albania":"https://i.imgur.com/Skf6vdi.png","euronews bulgaria":"https://i.imgur.com/RrQVoOg.png","euronews deutsch":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Euronews_2022.svg/500px-Euronews_2022.svg.png","euronews em portugu s":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Euronews_2022.svg/500px-Euronews_2022.svg.png","euronews espa ol":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Euronews_2022.svg/500px-Euronews_2022.svg.png","euronews fran ais":"https://i.imgur.com/3Lr5iAj.png","euronews georgia":"https://i.imgur.com/VNJ4soR.png","euronews greek":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Euronews_2016_logo.svg/500px-Euronews_2016_logo.svg.png","euronews hungarian":"https://upload.wikimedia.org/wikipedia/commons/7/7e/Euronews._2016_logo.png","euronews in diretta":"https://i.imgur.com/DUUxsO7.jpeg","euronews italian":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Euronews_2022.svg/500px-Euronews_2022.svg.png","euronews pluto tv":"https://i.imgur.com/Zpf2ykM.png","euronews rom nia":"https://i.imgur.com/jUOVUXt.png","ewtn tv":"https://katolikus.tv/wp-content/themes/bonum/img/ewtn-badge.jpg","ex on the beach pluto tv":"https://i.imgur.com/IONkdyk.png","exitosa ex karibe a":"https://i.pinimg.com/280x280_RS/11/85/b6/1185b667fe3f80d7072359d7ce7ce52d.jpg","expressen tv":"https://i.imgur.com/8EjMSr7.png","extra tv":"https://i.imgur.com/KCBurST.png","fail army pluto tv":"https://i.imgur.com/SqRDd2U.png","failarmy":"https://i.imgur.com/WupT16d.jpg","family rakuten tv":"https://i.imgur.com/BCC123A.jpg","fano tv":"https://i.imgur.com/orqEzJ6.png","fascino tv":"https://i.imgur.com/4XYYY5B.png","fashion tv":"https://i.imgur.com/KT3zgc1.png","federalna televizija ftv":"https://i.imgur.com/Jpvs4u3.png","feh rv rtv":"https://www.fehervartv.hu/css/img/icon-1-2.png","fem3 tv2 klub":"https://i.imgur.com/AF4Sz8Z.png","film azione pluto tv":"https://i.imgur.com/ZmAuf3H.png","film classici pluto tv":"https://i.imgur.com/jNyZPLV.png","film commedia pluto tv":"https://i.imgur.com/cSKaVHW.png","film d azione rakuten tv":"https://i.imgur.com/KDmDQM6.jpg","film detective":"https://i.imgur.com/4aFLH9g.png","film drama pluto tv":"https://i.imgur.com/X8jimKP.png","film pluto tv":"https://i.imgur.com/QeFc7F3.png","film romantici pluto tv":"https://i.imgur.com/KxPsLG3.png","film thriller pluto tv":"https://i.imgur.com/hIWMGRW.png","film top rakuten tv":"https://i.imgur.com/OfD9hM9.jpeg","filmrise movies":"https://i.imgur.com/jGzMaRD.png","filmrise sci fi":"https://i.imgur.com/FcN1OKo.png","fireplace pluto tv":"https://i.imgur.com/csk1e76.png","first channel 1tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Pirveli_Arkhi_Logo_2022.svg/500px-Pirveli_Arkhi_Logo_2022.svg.png","first channel education 2tv":"https://upload.wikimedia.org/wikipedia/ka/c/c9/2_Tv_Logo.jpg","flicks of fury":"https://i.imgur.com/yhyzBfb.png","fm tv marche":"https://i.imgur.com/yY01NhL.jpg","fm104":"https://upload.wikimedia.org/wikipedia/commons/c/cb/FM104_logo_tile.png","focus":"https://i.imgur.com/M4smqpF.png","folk club tv":"https://i.imgur.com/vkGFSl8.png","folk tv":"https://i.imgur.com/4b9aZ9P.png","folketinget tv":"https://i.imgur.com/RqQDUzX.png","folx slovenija":"https://i.imgur.com/RK1IASU.png","food network":"https://i.imgur.com/i60OYr9.png","forensic files pluto tv":"https://i.imgur.com/hF5maH7.png","formula":"https://i.imgur.com/fsqBn8G.png","fox weather":"https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Fox_Weather_logo.svg/500px-Fox_Weather_logo.svg.png","france 24":"https://i.imgur.com/61MSiq9.png","france 24 espa ol":"https://i.imgur.com/61MSiq9.png","france 3":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/France_3_2018.svg/960px-France_3_2018.svg.png","france 4":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/France_4_2018.svg/960px-France_4_2018.svg.png","france 5":"https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/France_5_2018.svg/960px-France_5_2018.svg.png","france inter":"https://i.imgur.com/d9Ncl8m.png","franceinfo":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Franceinfo.svg/500px-Franceinfo.svg.png","free om":"https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/FreeDOMUAlogo.svg/500px-FreeDOMUAlogo.svg.png","frii":"https://i.imgur.com/ljKoG9I.png","frikanalen":"https://i.imgur.com/rY3Owxl.png","frisbee":"https://i.imgur.com/9y1zIAe.png","ftv news":"https://i.imgur.com/j9Gebr5.png","ftv one":"https://i.imgur.com/HBT2o0I.png","ftv taiwan":"https://i.imgur.com/p108I5g.png","fuel tv":"https://i.imgur.com/4Lzo6M4.png","full moon":"https://i.imgur.com/0xT7bZP.jpg","fztv 1 news":"https://i.imgur.com/QvBxGw3.png","fztv 3 lifestyle channel":"https://i.imgur.com/jt7CWDT.png","fztv 4 children":"https://i.imgur.com/J4WtNTX.png","g1 tv":"https://i.imgur.com/TYYffUe.png","galmudug tv":"https://www.lyngsat.com/logo/tv/gg/galmudug-tv-so.png","gambero rosso":"https://i.imgur.com/RApMW5x.png","garganotv":"https://i.imgur.com/OlJohKK.png","gayelle":"https://i.imgur.com/GhWdqLq.jpg","gb news":"https://upload.wikimedia.org/wikipedia/en/thumb/3/35/GB_News_Logo.svg/500px-GB_News_Logo.svg.png","gemstv":"https://i.imgur.com/IR2sTag.png","geordie shore pluto tv":"https://i.imgur.com/y0fkHVi.png","giallo":"https://i.imgur.com/0PIRwZS.png","giornale radio tv":"https://i.imgur.com/TMtvCLL.jpg","giovanni paolo tv":"https://i.imgur.com/GH5eJE6.png","global news saskatoon":"https://i.imgur.com/IpfmG93.png","global news winnipeg":"https://i.imgur.com/IpfmG93.png","globo tv":"https://i.imgur.com/lR08pb3.jpeg","globovisi n":"https://upload.wikimedia.org/wikipedia/en/4/47/Globovisi%C3%B3n_logo_2013.png","globus television":"https://i.imgur.com/yUTYqCv.png","gnomi":"https://i.imgur.com/mHCk05E.png","go tv channel":"https://i.imgur.com/xgjrAAn.png","gold tv":"https://i.imgur.com/3rVi4kD.png","good news today":"https://i.imgur.com/vbSR4cA.png","grande fratello vip regia 1":"https://i.imgur.com/PBTdU4G.png","grande fratello vip regia 2":"https://i.imgur.com/FKfwbHD.png","grande fratello vip regia un ora fa":"https://i.imgur.com/fFZeBnc.png","great movies":"https://upload.wikimedia.org/wikipedia/en/thumb/9/92/Great%21_Movies_logo_2021.svg/500px-Great%21_Movies_logo_2021.svg.png","great romance":"https://www.freeview.co.uk/sites/default/files/styles/255_wide/public/2023-09/GREAT-Christmas-logo.png","grp televisione":"https://i.imgur.com/1zNPpVE.png","gs channel":"https://i.imgur.com/ExfxCRv.png","gstv":"https://i.imgur.com/ECnVG5I.png","gulli":"https://upload.wikimedia.org/wikipedia/fr/thumb/4/43/18._Gulli.png/60px-18._Gulli.png","gy ngy s tv":"https://i.imgur.com/RHgaPCk.png","h r tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Hirtvujlogo05.jpg/250px-Hirtvujlogo05.jpg","halom tv":"https://www.halomtv.hu/sites/all/themes/gfx_zen/logo.png","hawe tv vitebsk":"https://i.imgur.com/HOb5m5f.jpg","heartland":"https://i.imgur.com/a67bbag.png","hegyvid k tv buda tv":"https://hegyvidektv.hu/wp-content/uploads/2025/05/BUDATV_logo_picon.png","hero":"https://upload.wikimedia.org/wikipedia/commons/b/bd/Hero_color_RGB.png","hgtv home garden tv":"https://i.imgur.com/emLNC0U.png","high tv":"https://i.imgur.com/wHzCGry.png","himlen tv7":"https://i.imgur.com/a4iNVXA.png","hipodromo de las americas":"https://i.imgur.com/wc8MlGw.png","hirshabelle tv":"https://www.lyngsat.com/logo/tv/hh/hirshabelle-tvjpg-so.png","hlektra":"https://i.imgur.com/LbogUPS.png","hobby maker":"https://i.imgur.com/VWHp5Tl.png","horn cable tv":"https://i.imgur.com/qUqQCjP.png","horror pluto tv":"https://i.imgur.com/zhoHRSE.png","house of docs pluto tv":"https://i.imgur.com/pFLQ18m.png","houses of the oireachtas channel":"https://i.imgur.com/aC4fsCI.png","hoy tv":"https://i.imgur.com/NfVZPTT.png","hrt 1":"https://upload.wikimedia.org/wikipedia/commons/1/1f/HRT1-logo.png","hrt 2":"https://upload.wikimedia.org/wikipedia/commons/d/d0/Htv2-logo.png","hrt 3":"https://upload.wikimedia.org/wikipedia/commons/9/96/HRT3_Logo_aktuell.png","hrt 4":"https://upload.wikimedia.org/wikipedia/commons/7/76/HRT4-logo.png","humanity documentari":"https://i.imgur.com/4gwdyar.png","i ctimai tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/%C4%B0ctimai_TV_%282021%29.png/120px-%C4%B0ctimai_TV_%282021%29.png","i24 news":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/79/LOGO_i24NEWS.png/500px-LOGO_i24NEWS.png","ib3 global":"https://raw.githubusercontent.com/tv-logo/tv-logos/refs/heads/main/countries/spain/ib3-es.png","icaro tv rimini":"https://i.imgur.com/z05VSSN.png","ici montreal":"https://i.imgur.com/Z1b2TJD.png","ici rdi":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/ICI_RDI_logo.svg/500px-ICI_RDI_logo.svg.png","ici t l hd":"https://i.imgur.com/HsSi3NV.png","ictv serialy":"https://upload.wikimedia.org/wikipedia/commons/7/7a/ICTV_Serialy_%282024%29.png","ictv2":"https://i.imgur.com/J4zlRGv.png","idea plus":"https://i.imgur.com/2edmxYF.png","ifilm":"https://i.imgur.com/4Z9L1AW.png","ifilm 2":"https://i.imgur.com/WZrGsFb.png","ifilm arabic":"https://i.imgur.com/D3cXTpJ.png","ifilm english":"https://i.imgur.com/RdC0DQk.png","il banco dei pugni pluto tv":"https://i.imgur.com/2Lj1sdf.png","il testimone pluto tv":"https://i.imgur.com/9NXL9kY.png","il61":"https://i.imgur.com/1rUZsBv.png","imedi tv":"https://upload.wikimedia.org/wikipedia/commons/2/2a/Imlogo_2020.png","inazuma eleven pluto tv":"https://i.imgur.com/2u1ic6X.png","india tv":"https://upload.wikimedia.org/wikipedia/en/thumb/6/60/India_tv_logo-en.png/500px-India_tv_logo-en.png","inews":"https://i.imgur.com/PeuBkaH.png","informer tv":"https://i.imgur.com/9wdEHRf.png","inter":"https://i.imgur.com/R06gbuT.png","inter tv":"https://intervenhosting.net/imagenes/itv.jpg","intv":"https://i.imgur.com/K7BSjqY.png","ionian channel":"https://i.imgur.com/ADVYeQd.png","iranpress":"https://i.imgur.com/Qrubr3v.png","iraq future":"https://i.imgur.com/Z7woTe5.png","irib amoozesh":"https://i.imgur.com/qox2azH.png","irib mostanad":"https://i.imgur.com/lRDgugZ.png","irib namayesh":"https://i.imgur.com/Nq0pCGr.png","irib nasim":"https://i.imgur.com/EqjQN83.png","irib ofogh":"https://i.imgur.com/fhqeYGb.png","irib omid":"https://i.imgur.com/s9iUe1l.png","irib pooya nahal":"https://i.imgur.com/hjeQUtg.png","irib quran":"https://i.imgur.com/nmOKBaK.png","irib salamat":"https://i.imgur.com/K0YUhne.png","irib tamasha":"https://i.imgur.com/YffSCWH.png","irib tv1":"https://i.imgur.com/rad9Guw.png","irib tv2":"https://i.imgur.com/FKiTd3O.png","irib tv3":"https://i.imgur.com/6cIaH0c.png","irib tv4":"https://i.imgur.com/fsdz81l.png","irib tv5 tehran tv":"https://i.imgur.com/VdOFcN4.png","irib uhd hdr":"https://i.imgur.com/qZ98jaa.png","irib varzesh":"https://i.imgur.com/tRLSrxa.png","irinn":"https://i.imgur.com/7HL4joq.png","iris":"https://i.imgur.com/Ixz1BY3.png","istv":"https://upload.wikimedia.org/wikipedia/pt/b/b5/Logotipo_da_ISTV.png","itage tv":"https://i.imgur.com/ojLIfkt.jpeg","italia 1":"https://i.imgur.com/oCiOxBG.png","italia 2":"https://i.imgur.com/nq48sjO.png","italia 2 tv":"https://i.imgur.com/ISbxfY0.png","italia 7":"https://i.imgur.com/YBXkY4w.png","italia 8 prestige":"https://i.imgur.com/uDxWI4a.png","italia channel":"https://i.imgur.com/zuuKXGv.png","italian fishing tv":"https://i.imgur.com/Q0jHCdC.png","itv 1":"https://upload.wikimedia.org/wikipedia/en/thumb/1/1f/ITV1_logo_%282022%29.svg/500px-ITV1_logo_%282022%29.svg.png","itv 2":"https://i.imgur.com/Ji65OXG.png","itv 3":"https://i.imgur.com/vYNyYGx.png","itv 4":"https://upload.wikimedia.org/wikipedia/en/thumb/5/57/ITV4_logo_%282022%29.svg/500px-ITV4_logo_%282022%29.svg.png","iunior tv":"https://i.imgur.com/9jeNlLE.png","izaura tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Izaura_TV_logo.svg/250px-Izaura_TV_logo.svg.png","j rviradio tv":"https://jarviradio.fi/jrtv2/wp-content/uploads/2022/01/jrtv1.jpg","j sports 1":"https://www.starcat.co.jp/ch/upload/channel/69/jsports1_logo.jpg","j sports 2":"https://www.starcat.co.jp/ch/upload/channel/70/jsports2_logo.jpg","j sports 3":"https://www.starcat.co.jp/ch/upload/channel/71/jsports3_logo.jpg","j sports 4":"https://www.starcat.co.jp/ch/upload/channel/74/jsports4_logo.jpg","jazz tv":"https://i.imgur.com/4U6Ju5G.png","jersey shore pluto tv":"https://i.imgur.com/HIlmQEy.png","jewellery maker":"https://i.imgur.com/O7SdkBh.png","jibs tv":"https://i.imgur.com/RVWpBoz.png","joj cinema":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/joj-cinema-cz.png","joj family":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/joj-family-cz.png","joy news":"https://i.imgur.com/kGuMNmR.png","jtv tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Jtv_logo.svg/500px-Jtv_logo.svg.png","jubbaland tv":"https://i.imgur.com/SEgEYjV.png","just for laughs pluto tv":"https://i.imgur.com/VvEz0XX.png","k pop pluto tv":"https://i.imgur.com/9Vp4rx2.png","kanal 10 norge":"https://i.imgur.com/2fOcZfK.png","kanal 10 sverige":"https://i.imgur.com/vlh699v.png","kanal 5":"https://i.imgur.com/Qw7N3S2.png","kanal 6":"https://i.imgur.com/GGhvR0l.png","kanal hovedstaden":"https://i.imgur.com/MCXYDwH.png","kanal ri":"https://kanal-ri.hr/wp-content/uploads/2022/09/kanalRi_logo_v1.png","kanal s":"https://i.imgur.com/W0JBoSQ.png","kanali 7":"https://i.imgur.com/rL2v9pM.png","kapos tv":"https://kapos.hu/static/keptar/13/b/9490.jpg","kbc tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/KBC_Gwangju_Broadcasting_logo.svg/500px-KBC_Gwangju_Broadcasting_logo.svg.png","kbs 1tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/KBS_1_logo.svg/500px-KBS_1_logo.svg.png","kbs korea":"https://kbsworldimage.kbs.co.kr/images/layout/logo/logo_korea_n.png","kbs world":"https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/KBS_World_%282009%29.svg/500px-KBS_World_%282009%29.svg.png","kctv":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Logo_of_the_Korean_Central_Television.svg/500px-Logo_of_the_Korean_Central_Television.svg.png","kecskem t tv":"https://kecskemetitv.hu/templates/kecskemetitv/img/ktv_logo.png","kentron tv":"https://i.imgur.com/eCaxBFn.png","kgs tv":"https://i.imgur.com/MCDFlCk.png","kibris tv":"https://i.imgur.com/5MJZPTo.png","kids pluto tv":"https://i.imgur.com/ybd7A0r.png","kids ukraine pluto tv":"https://i.imgur.com/MrIlypV.png","kika":"https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Kika_2012.svg/500px-Kika_2012.svg.png","klasik":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/slovakia/markiza-sk.png","knesset":"https://i.imgur.com/PEdXHSE.png","knn tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/KNN_logo.svg/500px-KNN_logo.svg.png","knr1":"https://i.imgur.com/8Pf5SJb.png","knr2":"https://i.imgur.com/8Pf5SJb.png","ko expres":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/ocko-expres-cz.png","ko star":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/ocko-star-cz.png","komlos tv":"https://i.imgur.com/MDYb5yz.png","kontra":"https://i.imgur.com/ROZ9VfV.png","kriti 1":"https://i.imgur.com/C1ucQeC.png","kriti tv":"https://i.imgur.com/eLhYMmc.png","kropyvnytskyi":"https://i.imgur.com/zzYJr87.png","ktca dt5":"https://upload.wikimedia.org/wikipedia/en/b/be/Twin_Cities_Public_Television_logo_%28PBS%29.png","ktn home":"https://i.imgur.com/7yzunBK.png","ktn news tv":"https://i.imgur.com/7yzunBK.png","kunskapskanalen":"https://i.imgur.com/9YBxoGc.png","kurir tv":"https://i.imgur.com/HBPnUD5.png","kutonen":"https://i.imgur.com/4giVyxb.png","kvf sj nvarp":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Kringvarp_F%C3%B8roya_2018.svg/500px-Kringvarp_F%C3%B8roya_2018.svg.png","l altro corriere tv":"https://i.imgur.com/dgj79J3.png","l gr muzika":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/slagr-muzika-cz.png","l gr origin l":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/slagr-original-cz.png","l gr premium":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/slagr-premium-cz.png","l quipe":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/L%27%C3%89quipe_wordmark.svg/500px-L%27%C3%89quipe_wordmark.svg.png","la 1":"https://i.imgur.com/NbesiPn.png","la 1 canarias":"https://i.imgur.com/NbesiPn.png","la 1 catalunya":"https://i.imgur.com/NbesiPn.png","la 2":"https://i.imgur.com/DmuTwDw.png","la 2 canarias":"https://i.imgur.com/DmuTwDw.png","la 2 catalunya":"https://i.imgur.com/DmuTwDw.png","la 5":"https://i.imgur.com/UNyJaho.png","la nuova tv":"https://i.imgur.com/wg8FhdN.png","la otra":"https://i.imgur.com/W1UZyXH.png","la sexta":"https://i.imgur.com/b59MxgM.png","la tenda tv":"https://i.imgur.com/XnBp0hT.png","la tr3 marsala":"https://i.imgur.com/XlxpfEx.png","la trois":"https://i.imgur.com/kC3pJtA.png","la une":"https://i.imgur.com/hJodwJt.png","la7 cinema":"https://i.imgur.com/khPweok.png","lab tv":"https://i.imgur.com/OpRS6Fl.png","lac news 24":"https://i.imgur.com/02vCECa.png","lac tv calabria":"https://i.imgur.com/2Ef6crS.png","latina tv":"https://intervenhosting.net/imagenes/latinatv.jpg","lazio tv":"https://i.imgur.com/DAj5Uwb.png","le cronache lucane tv":"https://i.imgur.com/EBY3IZL.jpg","le sorelle mcleod pluto tv":"https://i.imgur.com/P310ryf.png","le vite degli altri pluto tv":"https://i.imgur.com/nngMFi5.png","lepanto":"https://i.imgur.com/h6Tqe0k.png","libertas tv":"https://upload.wikimedia.org/wikipedia/hr/8/8a/LibertasTV.png","lietuvos rytas tv":"https://i.imgur.com/5wpxVI0.png","life tv estonia":"https://i.imgur.com/JhrTB82.png","life tv europe":"https://i.imgur.com/JhrTB82.png","lira tv":"https://i.imgur.com/S0ReVEo.png","livenow from fox":"https://i.imgur.com/1JnyzHv.png","ln24":"https://i.imgur.com/hePpxnn.png","lokal tv uddevalla fyrbodal tv":"https://i.imgur.com/cnLkbOT.png","lombardia tv":"https://i.imgur.com/aksVy9f.jpg","love in venice":"https://i.imgur.com/lLBzzce.png","love tv":"https://i.imgur.com/B8iaejQ.png","lrt lituanica":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/LRT_Lituanica_Logo_2022.svg/500px-LRT_Lituanica_Logo_2022.svg.png","lrt plius":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/LRT_Plius_Logo_2022.svg/500px-LRT_Plius_Logo_2022.svg.png","lrt tv":"https://i.imgur.com/FL2ZuGC.png","ltv1":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/LTV1_%282022%29.svg/960px-LTV1_%282022%29.svg.png","ltv7":"https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/LTV7_Logo_2021.svg/960px-LTV7_Logo_2021.svg.png","lucania tv":"https://i.imgur.com/wuUNVR5.png","m d niyy t tv":"https://upload.wikimedia.org/wikipedia/commons/f/fc/M%C9%99d%C9%99niyy%C9%99t_TV_logo.png","m net":"https://i.imgur.com/JWHcGMX.png","m net info":"https://i.imgur.com/O26HEyC.png","m net sport":"https://i.imgur.com/q3DV2gP.png","m1 hirad":"https://i.imgur.com/neddXUd.png","m2 pet fi tv":"https://i.imgur.com/CzaDhmA.png","m4 sport":"https://nb1.hu/uploads/news/3/31023.jpg","m4tv":"https://i.imgur.com/HZohlNk.png","m5 hungary":"https://i.imgur.com/qLQz2V6.png","macgyver pluto tv":"https://i.imgur.com/bz9IwWU.png","made in bo":"https://i.imgur.com/WFnrMS0.png","made pluto tv":"https://i.imgur.com/dguQsJ7.png","mai dire s pluto tv":"https://i.imgur.com/yIMyhSN.png","mak tv":"https://i.imgur.com/90iDHbQ.png","man ga":"https://i.imgur.com/8a6WYU2.png","maria vision":"https://i.imgur.com/fdx5YXi.png","mark za":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/slovakia/markiza-sk.png","matrix tv":"https://i.imgur.com/m1HeXrn.png","mbc 1":"https://i.imgur.com/CiA3plN.png","mbc 2":"https://i.imgur.com/n9mSHuP.png","mbc 3":"https://i.imgur.com/PVt8OPN.png","mbc 4":"https://i.imgur.com/BcXASJp.png","mbc 5":"https://i.imgur.com/fRWaDyF.png","mbc action":"https://i.imgur.com/OWZAghw.png","mbc bollywood":"https://i.imgur.com/TTAGFHG.png","mbc drama":"https://i.imgur.com/g5PWnqp.png","mbc masr 1":"https://upload.wikimedia.org/wikipedia/commons/7/7c/MBC_Masr_Logo.png","mbc max":"https://i.imgur.com/A02CptP.png","mbc persia":"https://i.imgur.com/4FXiyjn.png","mbc tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Munhwa_Broadcasting_Corporation.svg/500px-Munhwa_Broadcasting_Corporation.svg.png","mdr sachsen":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/MDR_Logo_2017.svg/500px-MDR_Logo_2017.svg.png","mdr sachsen anhalt":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/MDR_Logo_2017.svg/500px-MDR_Logo_2017.svg.png","mdr th ringen":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/MDR_Logo_2017.svg/500px-MDR_Logo_2017.svg.png","mediaset extra":"https://i.imgur.com/mM8lopo.png","mediaset italia america":"https://i.imgur.com/oh8ihqr.png","mediaset italia australia e asia":"https://i.imgur.com/oh8ihqr.png","mediaset italia europa e africa":"https://i.imgur.com/oh8ihqr.png","mediterranea tv":"https://i.imgur.com/GUTOqRt.png","medjugorje italia tv":"https://i.imgur.com/hkZScXf.png","medjugorje tv puglia":"https://i.imgur.com/IWBeddh.png","mega 2":"https://i.imgur.com/c1ME00r.png","mega news":"https://i.imgur.com/Z3k7iA0.png","meganoticias":"https://i.imgur.com/JCVEqTc.png","mesogeios tv":"https://i.imgur.com/tr0Lf9K.png","metro globe network":"https://i.imgur.com/aiiinzg.png","minformo tv":"https://i.imgur.com/VJNtnZM.jpg","mirror now":"https://i.imgur.com/R4rxBNu.jpeg","mm somali tv":"https://www.lyngsat.com/logo/tv/mm/mm-somali-tv-so.png","moconomy":"https://i.imgur.com/GvqbLZB.png","moldova 1":"https://i.imgur.com/ZbQY56v.png","moldova 2":"https://i.imgur.com/Hv6Nk8A.png","monacoinfo":"https://www.lyngsat.com/logo/tv/mm/monaco_info.png","mondo tv kids":"https://i.imgur.com/DMqKFIM.png","monster jam pluto tv":"https://i.imgur.com/jxGhINd.png","motor1tv":"https://i.imgur.com/UERYhO1.png","motori tv":"https://i.imgur.com/NWXQKbl.png","mrt 2 sat":"https://i.imgur.com/WF1Eeuz.png","mrt sat":"https://i.imgur.com/2bc5PvQ.png","mrt sobraniski kanal":"https://i.imgur.com/fyNQ8Nf.png","mrt1":"https://i.imgur.com/EkkyAE0.png","mrt2":"https://i.imgur.com/YvOrUnN.png","mrt3":"https://i.imgur.com/3VZrG4T.png","mrt4":"https://i.imgur.com/wSmxUqY.png","mrt5":"https://i.imgur.com/zcvKu1h.png","mtavari arkhi":"https://i.imgur.com/tLtGnJW.png","mtm 1":"https://i.imgur.com/w6Uy2Zd.png","mtv ava":"https://i.imgur.com/rtyJVgB.png","mtv azerbaijan":"https://i.imgur.com/lSBMeBU.png","mtv sub":"https://i.imgur.com/VRCuxQt.png","mtv uutiset live":"https://i.imgur.com/IyB6mIb.png","mtv3":"https://i.imgur.com/kNbmc8n.png","mutant x pluto tv":"https://i.imgur.com/SptYKFI.png","muz tv":"https://i.imgur.com/CjySP1V.png","mvm noticias":"https://i.imgur.com/dhLXN9n.png","n r tv":"https://i.imgur.com/Ht5yePq.png","n1 bosna i hercegovina":"https://i.imgur.com/72oMSWz.png","n1 hrvatska":"https://i.imgur.com/qcD1OOZ.png","naftemporiki tv":"https://i.imgur.com/9OFdMud.png","nasa tv media":"https://i.imgur.com/rmyfoOI.png","national geographic abu dhabi":"https://i.imgur.com/fNA00VF.png","national geographic finland":"https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Natgeologo.svg/500px-Natgeologo.svg.png","natura pluto tv":"https://i.imgur.com/Pc4gx12.png","naturescape pluto tv":"https://i.imgur.com/CGB6qiV.png","nbc news":"https://i.imgur.com/v48mMRT.png","nbc news now":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/united-kingdom/nbc-news-now-uk.png","ndr hamburg":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Logo_NDR_Fernsehen_2017.svg/500px-Logo_NDR_Fernsehen_2017.svg.png","ndr international":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Logo_NDR_Fernsehen_2017.svg/500px-Logo_NDR_Fernsehen_2017.svg.png","ndr mecklenburg vorpommern":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Logo_NDR_Fernsehen_2017.svg/500px-Logo_NDR_Fernsehen_2017.svg.png","ndr niedersachsen":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Logo_NDR_Fernsehen_2017.svg/500px-Logo_NDR_Fernsehen_2017.svg.png","ndr schleswig holstein":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Logo_NDR_Fernsehen_2017.svg/500px-Logo_NDR_Fernsehen_2017.svg.png","ndtv 24x7":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/india/ndtv-24x7-in.png","ndtv india":"https://i.imgur.com/QjJYohG.png","ndtv profit":"https://upload.wikimedia.org/wikipedia/en/thumb/1/18/NDTV_Profit.svg/1280px-NDTV_Profit.svg.png","negocios":"https://pbs.twimg.com/profile_images/1321367703731523584/bNMmbetI_200x200.jpg","nelonen":"https://i.imgur.com/BFbCyfY.png","neon tv":"https://i.imgur.com/thC9NFp.png","neox":"https://raw.githubusercontent.com/tv-logo/tv-logos/refs/heads/main/countries/spain/neox-es.png","net tv":"https://i.imgur.com/EWmshtx.png","news":"https://channel.rakuten.co.jp/service/img/logo/chlogo-with-number/104_ntvnews.png","news 24":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/News_24_%28Albania%29.svg/960px-News_24_%28Albania%29.svg.png","news central":"https://i.imgur.com/1oSxhmp.png","news18 india":"https://i.imgur.com/BR4BUAw.png","news18 kannada":"https://i.imgur.com/CQUGLoK.png","news18 marathi":"https://i.imgur.com/orxCvCa.png","news18 telugu":"https://i.imgur.com/NsieorM.jpeg","news18 up uttarakhand":"https://i.imgur.com/nKwoe8n.png","news24":"https://i.imgur.com/N5BbEek.jpeg","news24 city":"https://i.imgur.com/dak9AtV.png","nh nieuws":"https://i.imgur.com/SQPVOwn.png","nine":"https://i.imgur.com/SMXwfr5.png","nitv":"https://i.imgur.com/YR7sXaN.png","noor dubai":"https://i.imgur.com/DLe7ZuM.png","noovo":"https://i.imgur.com/BL9ziSJ.png","nopola news":"https://i.imgur.com/gOj8J6O.png","nova action":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/nova-action-cz.png","nova cinema":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/nova-cinema-cz.png","nova fun":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/nova-fun-cz.png","nova gold":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/nova-gold-cz.png","nova lady":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/nova-lady-cz.png","nova tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Nova_TV_Croatia_logo.png/500px-Nova_TV_Croatia_logo.png","nove":"https://i.imgur.com/Hp723RU.png","novyi kanal":"https://i.imgur.com/4JhqpPM.png","now 70s":"https://i.imgur.com/qiCCX5X.png","now 80s":"https://i.imgur.com/8paz37m.png","now rock":"https://upload.wikimedia.org/wikipedia/en/8/89/NOW_Rock_logo.png","nrk super":"https://i.imgur.com/xIATe2T.png","nrk1":"https://i.imgur.com/9tj8ds7.png","nrk2":"https://i.imgur.com/SiAdoK9.png","nrk3":"https://i.imgur.com/TNhV2I7.png","nrt 4 monclova":"https://i.imgur.com/IudKE0n.png","nti canale 271":"https://i.imgur.com/zlmcUe0.jpg","ntk tv":"https://www.ntktv.ua/bitrix/templates/ntk_copy/images/logo.png","nuova tv 1":"https://i.imgur.com/1yqTZhR.png","nuova tv 2":"https://i.imgur.com/0vauyV3.png","nuova tv nazionale":"https://i.imgur.com/QWlRuXg.png","nuvola tv":"https://i.imgur.com/EDGez2x.png","obieqtivi":"https://i.imgur.com/Kqc8H8X.png","obs tv":"https://i.imgur.com/oWB3ApR.png","odeon 24":"https://i.imgur.com/M1tVBuH.png","oe24":"https://i.imgur.com/8UTkcPn.png","ofanto tv":"https://i.imgur.com/UCgATWn.png","omroep brabant":"https://i.imgur.com/Jv7IjHJ.png","omroep flevoland":"https://i.imgur.com/d1CmTcI.png","omroep gelderland":"https://i.imgur.com/TPlyvUQ.png","omroep west":"https://i.imgur.com/aax1HPH.png","omroep zeeland":"https://i.imgur.com/8aLDyUI.png","omrop frysl n":"https://i.imgur.com/0VKJLAK.png","onda novara tv":"https://i.imgur.com/Qoh9CFy.png","onda tv sicilia":"https://i.imgur.com/0c5Y6lr.png","onda web radio":"https://i.imgur.com/3hTvrC8.jpg","one channel":"https://i.imgur.com/GwKaHbM.png","onnitv":"https://i.imgur.com/HzILf2H.png","open tv":"https://i.imgur.com/HzBmvPT.png","ora news":"https://i.imgur.com/ILZY5bJ.png","ora tv":"https://i.imgur.com/clWVrvE.png","orf iii":"https://i.imgur.com/6BuiUE7.png","orler tv":"https://i.imgur.com/dBkxD8e.png","oroszl nyi v rosi telev zi":"https://i.imgur.com/P0fxUH5.png","osje ka televizija ostv":"https://i.imgur.com/o9JgEyG.png","otto channel":"https://i.imgur.com/HRonD2N.png","p3tv":"https://i.imgur.com/1sPhZ57.png","padre pio tv":"https://i.imgur.com/7ajxEPH.png","pakapaka":"https://i.imgur.com/Q4zaCuM.png","panamericana tv":"https://upload.wikimedia.org/wikipedia/commons/2/26/Panamericana_tv_2009.png","pannon rtv":"https://i.imgur.com/iD5tCjX.png","panorama tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Panorama_logo.svg/500px-Panorama_logo.svg.png","paradise tv":"https://i.imgur.com/okIBfIb.jpg","paramount movie channel":"https://i.imgur.com/CfqRav0.png","paramount network":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Paramount_Network.svg/500px-Paramount_Network.svg.png","parole di vita":"https://i.imgur.com/M9mIiZD.png","partenope tv":"https://i.imgur.com/FtuWkj1.png","peer tv alto adige":"https://www.peer.biz/peertv-iptv/peer-tv-alto-adige.png","peer tv s dtirol":"https://www.peer.biz/peertv-iptv/peer-tv-suedtirol.png","peer tv south tyrol":"https://www.peer.biz/peertv-iptv/peer-tv-south-tyrol.png","pella":"https://i.imgur.com/pwUkkGL.jpeg","people are awesome":"https://i.imgur.com/xwz9zKk.jpeg","people are awesome pluto tv":"https://i.imgur.com/jn0OeWv.png","perfil":"https://i.imgur.com/3wZdPwN.png","pershyi":"https://i.imgur.com/osTQLED.png","pervyy gorodskoy odessa":"https://i.imgur.com/8qdc6aO.png","pervyy muzykal nyy by":"https://i.imgur.com/7tFiG6S.jpg","pfl mma pluto tv":"https://i.imgur.com/zScgLTv.png","phoenix":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Phoenix-logo-2018.svg/500px-Phoenix-logo-2018.svg.png","pimp my ride pluto tv":"https://i.imgur.com/GC2wj2K.png","planeta junior":"https://i.imgur.com/F71WMja.jpg","planeta rtr":"https://i.imgur.com/yqRuEJd.png","plava vinkova ka":"https://i.imgur.com/WJJNtQ3.jpg","pluto tv action":"https://i.imgur.com/g8PCdh6.png","pluto tv comedy":"https://i.imgur.com/Pjs4lgs.png","pluto tv crime movies":"https://i.imgur.com/PlAQrIb.png","pluto tv cult films":"https://i.imgur.com/kD3SkoC.png","pluto tv documentaries":"https://i.imgur.com/Mr4ZsNZ.png","pluto tv drama":"https://i.imgur.com/B9srooj.png","pluto tv fantastic":"https://i.imgur.com/dOfXc5w.png","pluto tv horror":"https://i.imgur.com/An93hAh.png","pluto tv romance":"https://i.imgur.com/j6livg0.png","pluto tv spotlight":"https://i.imgur.com/AogTmZc.png","pluto tv staff picks":"https://i.imgur.com/DFDHAT8.png","pluto tv terror":"https://i.imgur.com/JLgn5jC.png","pluto tv thrillers":"https://i.imgur.com/jyiFzG4.png","pluto tv westerns":"https://i.imgur.com/79R7m0b.png","pontos":"https://i.imgur.com/sbTxP6o.png","pop tv":"https://i.imgur.com/TeolCu9.png","port":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/slovakia/rtvs-sport-sk.png","porto canal":"https://i.imgur.com/wsyvP2H.png","pos tv":"https://i.imgur.com/UOiXFEW.png","ppna kanalen sk vde":"https://i.imgur.com/1LkYbaQ.png","praha tv":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/praha-tv-cz.png","press tv":"https://i.imgur.com/X3YP2Gg.png","press tv french":"https://i.imgur.com/X3YP2Gg.png","prima krimi":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/prima-krimi-cz.png","prima max":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/prima-max-cz.png","prima tv napoli":"https://i.imgur.com/yPuQeEy.jpg","prima tv sicilia":"https://i.imgur.com/br45JER.png","primafree":"https://i.imgur.com/YrSSmOL.png","primocanale":"https://i.imgur.com/xWF1A1U.png","pro tv":"https://i.imgur.com/aKAfKtW.png","promovideo tv":"https://i.imgur.com/MwK9HVG.png","pts taigi":"https://upload.wikimedia.org/wikipedia/zh/thumb/8/8a/PTS_Taigi.svg/500px-PTS_Taigi.svg.png","public s nat":"https://i.imgur.com/bJOdFT1.png","punt tv":"https://i.imgur.com/M88LoNl.png","puntland tv":"https://i.imgur.com/C8EvQUo.png","putnok v rosi tv":"https://i.imgur.com/eKXPBFb.png","qatar television":"https://i.imgur.com/N5RB4sp.png","qatar television 2":"https://i.imgur.com/iWJxDUm.png","qatar television the holy quran":"https://i.imgur.com/N5RB4sp.png","quarto canale flegreo":"https://i.imgur.com/8RKY3Du.png","qvc beauty":"https://i.imgur.com/ZBHtqk1.png","qvc extra":"https://i.imgur.com/TIe5T9Z.png","qvc style":"https://i.imgur.com/6HZlLL3.png","qvc uk":"https://i.imgur.com/6TWUVrh.png","r v 2":"https://i.imgur.com/yDKRuXQ.png","r101 tv":"https://i.imgur.com/mWeEa9T.png","racing com":"https://i.imgur.com/pma0OCf.png","radio 105 tv":"https://i.imgur.com/3NiLKvj.png","radio 3m inblu":"https://i.imgur.com/d7O7Uqa.png","radio 51 tv":"https://uaznao.com/wp-content/uploads/2023/03/radio51.png","radio arancia tv":"https://hostux.pics/images/2026/09/11/05_radio_arancia_tv84cccbbd33923281.png","radio bianconera tv":"https://hostux.pics/images/2026/09/11/06_radio_bianconera_tv4a5c7bf00662f7ba.png","radio birikina tv":"https://uaznao.com/wp-content/uploads/2023/03/radiobirikina.png","radio bremen":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Logo_Radio_Bremen.svg/500px-Logo_Radio_Bremen.svg.png","radio bruno tv":"https://i.imgur.com/y4vKE83.png","radio colonna tv":"https://i.imgur.com/EcQvDfq.png","radio delta 1 tv":"https://hostux.pics/images/2026/09/11/07_radio_delta_1_tvc17419f8a8df1da6.png","radio digiesse tv":"https://hostux.pics/images/2026/09/11/08_radio_digiesse_tv62f4f919c0d901ef.png","radio hit orsk":"https://i.imgur.com/e2RyN4r.jpg","radio ibiza":"https://i.imgur.com/uu0DHY5.png","radio iglesias visual radio":"https://hostux.pics/images/2026/09/11/09_radio_iglesias_visual_radio0c4227f7a483885d.png","radio immagine tv":"https://i.imgur.com/iQlXRAB.png","radio italia cina tv":"https://i.imgur.com/QGkyrO3.png","radio italia trend":"https://i.imgur.com/ecpfn3e.png","radio juke box tv":"https://hostux.pics/images/2026/09/11/10_radio_juke_box_tvaf2d724a9b16146f.png","radio kiss kiss italia tv":"https://hostux.pics/images/2026/09/11/11_radio_kiss_kiss_italia_tv14a58fd92334188a.png","radio kiss kiss napoli tv":"https://hostux.pics/images/2026/09/11/12_radio_kiss_kiss_napoli_tv9bfaa8b980862ccb.png","radio kiss kiss tv":"https://i.imgur.com/UTStxDW.png","radio libert":"https://i.imgur.com/HRvPlf5.png","radio m2o tv":"https://i.imgur.com/wl30UFj.png","radio monte kronio tv r m k":"https://i.imgur.com/t0I2Shi.jpg","radio montecarlo tv":"https://i.imgur.com/3TMMXmS.png","radio napoli emme":"https://hostux.pics/images/2026/09/11/13_radio_napoli_emme7a755fab8578a752.png","radio norba tv":"https://i.imgur.com/qftBPM9.png","radio nova":"https://upload.wikimedia.org/wikipedia/en/a/a1/Nova-web1-228x150.jpg","radio number one tv":"https://hostux.pics/images/2026/09/11/14_radio_number_one_tv7003522663a1b412.png","radio padova tv":"https://hostux.pics/images/2026/09/11/15_radio_padova_tv46f0206ee59dba68.png","radio piter pan tv":"https://uaznao.com/wp-content/uploads/2023/03/radiopiterpan.png","radio punto zero tv":"https://hostux.pics/images/2026/09/11/16_radio_punto_zero_tvb293db9d29587093.png","radio radio tv":"https://i.imgur.com/iKuRg2b.png","radio radiosa tv":"https://i.imgur.com/8kqyxvz.png","radio ritmo 80 tv":"https://hostux.pics/images/2026/09/11/17_radio_ritmo_80_tv695eff878745049b.png","radio roma":"https://i.imgur.com/RKvfStm.png","radio roma television":"https://i.imgur.com/RKvfStm.png","radio studio tv":"https://hostux.pics/images/2026/09/11/18_radio_studio_tv037362682a113768.png","radio taormina tv":"https://hostux.pics/images/2026/09/11/19_radio_taormina_tvd6556d66aa925cb7.png","radio televisione sarda":"https://hostux.pics/images/2026/09/11/20_radio_televisione_sarda1e0f712e2f44bb50.png","radio tiv azzurra":"https://hostux.pics/images/2026/09/11/21_radio_tivu_azzurra44ecaf55746f67ba.png","radio tv serie a":"https://i.imgur.com/2AvxGJF.png","radio zeta":"https://i.imgur.com/0MgCm1n.png","radio24 ilsole24oretv":"https://i.imgur.com/NTqrdWW.png","radiofreccia":"https://i.imgur.com/J5N9F7Z.png","radioitaliatv":"https://i.imgur.com/4VCEJuJ.png","rai 1":"https://i.imgur.com/CAx7yRm.png","rai 2":"https://i.imgur.com/zA0PTcs.png","rai 3":"https://i.imgur.com/9kuQCIi.png","rai 4":"https://i.imgur.com/XFkZRfv.png","rai 4k":"https://i.imgur.com/5gkt9DD.png","rai 5":"https://i.imgur.com/Leu2zTO.png","rai gulp":"https://i.imgur.com/lu1DPVb.png","rai italia asia e australia":"https://i.imgur.com/riXPOTh.png","rai italia europa e africa":"https://i.imgur.com/riXPOTh.png","rai italia nord america":"https://i.imgur.com/riXPOTh.png","rai italia sud america":"https://i.imgur.com/riXPOTh.png","rai movie":"https://i.imgur.com/RKpO8CE.png","rai news 24":"https://i.imgur.com/gdzGwB6.png","rai premium":"https://i.imgur.com/RKI4nFy.png","rai radio 2 visual radio":"https://i.imgur.com/nVBet0h.png","rai scuola":"https://i.imgur.com/tmtJW6s.png","rai sport":"https://i.imgur.com/xsGljsb.png","rai storia":"https://i.imgur.com/K8y5q8x.png","rai world premium":"https://i.imgur.com/q1EHOhz.png","rai yoyo":"https://i.imgur.com/DRSa3ys.png","ran friul":"https://i.imgur.com/Qs5eQPM.png","rave tv":"https://i.imgur.com/fDSyf6u.png","rbb berlin":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Rbb_Fernsehen_Logo_2017.08.svg/500px-Rbb_Fernsehen_Logo_2017.08.svg.png","rbb brandenburg":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Rbb_Fernsehen_Logo_2017.08.svg/500px-Rbb_Fernsehen_Logo_2017.08.svg.png","rcg 3 saltillo":"https://i.imgur.com/NefH5qZ.png","rde tv":"https://i.imgur.com/NiwPlrr.png","rds social tv":"https://i.imgur.com/TY6FhqI.png","real life pluto tv":"https://i.imgur.com/FpwqJYw.png","real time":"https://i.imgur.com/9dcTYg1.png","real tv":"https://i.imgur.com/e2KFL0R.png","reality pluto tv":"https://i.imgur.com/tPEOeTk.png","red tv":"https://i.imgur.com/cpN7NrL.png","rede brasil":"https://upload.wikimedia.org/wikipedia/commons/d/d1/Marca_rede_brasil_rgb-color.png","reggio tv":"https://i.imgur.com/merrg2C.png","rei tv":"https://i.imgur.com/YNRWFOo.png","rejo tv":"https://www.lyngsat.com/logo/tv/rr/rejo-tv-so.png","renegade pluto tv":"https://i.imgur.com/Qsd9wuS.png","report tv":"https://i.imgur.com/yuRDJYY.png","republic bharat":"https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Republic_Bharat_logo.svg/500px-Republic_Bharat_logo.svg.png","rete 4":"https://i.imgur.com/GWx2Fkl.png","rete 55":"https://i.imgur.com/EsZn2cj.png","rete 7 tv":"https://i.imgur.com/lUTxfoh.png","rete 8":"https://i.imgur.com/bGsjPRh.png","rete 8 sport":"https://i.imgur.com/uUAjWlF.png","rete 8 vga":"https://i.imgur.com/3wF2AJX.jpg","rete biella tv":"https://i.imgur.com/e2ryHx7.png","rete mia":"https://i.imgur.com/kCJ621Q.png","rete oro tv":"https://i.imgur.com/OCxGtwA.png","rete sole":"https://i.imgur.com/u0ezKgE.png","rete tv italia":"https://i.imgur.com/lXGWoV9.png","rete veneta":"https://i.imgur.com/cInhQFp.png","retro music tv":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/retro-cz.png","retro tv":"https://i.imgur.com/PNTYOgg.png","retv":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/ReTV_Zals.svg/500px-ReTV_Zals.svg.png","reuters":"https://i.imgur.com/6eQ2nCJ.png","reuters tv":"https://i.imgur.com/AbvCnoH.png","rev n":"https://i.imgur.com/VUhqVgG.png","riccanza pluto tv":"https://i.imgur.com/oBpcWEm.png","ridiculousness pluto tv":"https://i.imgur.com/Yyj3Dm6.png","riigikogu":"https://i.imgur.com/7uWaZLF.png","rik 1":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Logo_RIK_1_2017.svg/500px-Logo_RIK_1_2017.svg.png","rik 2":"https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Logo_RIK_2_2017.svg/500px-Logo_RIK_2_2017.svg.png","rik hd":"https://upload.wikimedia.org/wikipedia/el/7/7d/RIKHD2.png","risate all italiana":"https://i.imgur.com/LCN66Z1.png","rmc life ex ch rie 25":"https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Ch%C3%A9rie_25_2015_logo.svg/500px-Ch%C3%A9rie_25_2015_logo.svg.png","robot wars by mech pluto tv":"https://i.imgur.com/vGqha3k.png","rock tv":"https://i.imgur.com/Y9miDQo.png","rom nia tv":"https://i.imgur.com/ZIfEp5I.png","roma tv 82":"https://i.imgur.com/C3UnlFF.png","romance rakuten tv":"https://i.imgur.com/TiXrzJZ.jpeg","rossini tv":"https://i.imgur.com/K0Em0nx.jpg","rotana ciip":"https://i.imgur.com/nhREk0o.png","rotana cinema":"https://upload.wikimedia.org/wikipedia/commons/9/92/Rotana_Cinema_Egy.png","rotana cinema ksa":"https://i.imgur.com/pGgp38I.png","rotana classic":"https://i.imgur.com/pMMUvkt.png","rotana comedy":"https://i.imgur.com/IlT8U6S.png","rotana drama":"https://i.imgur.com/btnhPjZ.png","rotana khalijia":"https://i.imgur.com/6HMluzv.png","rotana music":"https://i.imgur.com/2zFQbQi.png","rsi la 1":"https://i.imgur.com/j8ogbli.png","rsi la 2":"https://i.imgur.com/vm62h3t.png","rt 2":"https://upload.wikimedia.org/wikipedia/en/thumb/1/11/RT%C3%892_logo.svg/500px-RT%C3%892_logo.svg.png","rt documentary english":"https://i.imgur.com/ZEi1Wgn.png","rt espa ol":"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Russia-today-logo.svg/500px-Russia-today-logo.svg.png","rt one":"https://upload.wikimedia.org/wikipedia/en/thumb/e/e4/RT%C3%89_One_2014.svg/500px-RT%C3%89_One_2014.svg.png","rtc quarta rete":"https://i.imgur.com/rFGA6qL.png","rtc telecalabria":"https://i.imgur.com/tTYLcuh.jpg","rte news":"https://upload.wikimedia.org/wikipedia/en/7/78/Updated_RT%C3%89_News_and_Current_Affairs_Logo.png","rthk tv 31":"https://i.imgur.com/kf818kM.png","rthk tv 32":"https://i.imgur.com/MXLuUoU.png","rti calabria":"https://i.imgur.com/hVzEvmo.jpg","rtk 3":"https://i.imgur.com/Ut9VcT3.png","rtl 102 5":"https://i.imgur.com/KdissvS.png","rtl 102 5 plus":"https://i.imgur.com/mPqDtCO.png","rtl 102 5 traffic":"https://i.imgur.com/GH7byqm.jpeg","rtl 2":"https://i.imgur.com/dQLaylJ.png","rtl be":"https://i.imgur.com/xMhSvax.png","rtl klub":"https://i.imgur.com/ruRshE1.png","rtl kockica":"https://i.imgur.com/BiSVmRa.png","rtl t l l tzebuerg":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/RTL_Luxembourg_2023.svg/500px-RTL_Luxembourg_2023.svg.png","rtl zwee":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/RTL_Zwee_2023.svg/960px-RTL_Zwee_2023.svg.png","rtm manduria":"https://i.imgur.com/WwzU0EP.png","rtn napoli":"https://hostux.pics/images/2026/09/11/22_rtn_napoli29538077f1c13762.png","rtp a ores":"https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/RTP_A%C3%A7ores_%282016%29.svg/500px-RTP_A%C3%A7ores_%282016%29.svg.png","rtp frica":"https://i.imgur.com/ISFNy17.png","rtp madeira":"https://upload.wikimedia.org/wikipedia/en/a/ac/RTP_Madeira_2016.png","rtp mem ria":"https://upload.wikimedia.org/wikipedia/commons/7/79/RtpMemoria_positivo_horiz_RGB.png","rtp mundo":"https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/RTP_Mundo.svg/330px-RTP_Mundo.svg.png","rtp not cias":"https://upload.wikimedia.org/wikipedia/commons/b/b9/Rtp3.png","rtp tv":"https://i.imgur.com/I1hYI0C.png","rtp1":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/RTP1_-_Logo_2016.svg/500px-RTP1_-_Logo_2016.svg.png","rtp2":"https://upload.wikimedia.org/wikipedia/en/4/4d/Rtp2_2016_logo.png","rtp3":"https://upload.wikimedia.org/wikipedia/commons/b/b9/Rtp3.png","rtr99 tv":"https://i.imgur.com/mkO95pD.png","rtrs plus":"https://i.imgur.com/k06WvYl.png","rts 1":"https://i.imgur.com/S1pKHSR.png","rts 2":"https://i.imgur.com/jltAf5h.png","rts 3":"https://i.imgur.com/gxuGB4J.png","rts svet":"https://upload.wikimedia.org/wikipedia/commons/8/8a/Rts-svet.png","rts un":"https://i.imgur.com/gWuuBZc.png","rttr":"https://i.imgur.com/z7xMArA.png","rtv 1":"https://i.imgur.com/CG44YT3.png","rtv 2":"https://i.imgur.com/skpr66t.png","rtv 38 toscana":"https://i.imgur.com/xqlhJqK.png","rtv bn":"https://i.imgur.com/DUBvfWb.png","rtv drenthe":"https://i.imgur.com/GaGqM4z.png","rtv glas drine":"https://i.imgur.com/9NgxOdb.png","rtv hb":"https://upload.wikimedia.org/wikipedia/en/6/60/Logo_of_TV_Herceg-Bosne.png","rtv noord":"https://i.imgur.com/pO5Mexa.png","rtv oost":"https://i.imgur.com/8ropV29.png","rtv rijnmond":"https://i.imgur.com/TNhUVEm.png","rtv usk":"https://upload.wikimedia.org/wikipedia/en/f/ff/Logo_of_RTVUSK.png","rtv utrecht":"https://i.imgur.com/c0I24N6.png","rtv ze":"https://i.imgur.com/TKUaflB.png","rtve 24h":"https://i.imgur.com/WTDKOoM.png","russia today":"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Russia-today-logo.svg/500px-Russia-today-logo.svg.png","rustavi 2":"https://upload.wikimedia.org/wikipedia/commons/f/f8/Rustavi_2_logo.png","ryongnamsan tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/RyongnamsanTV_DPRK.png/500px-RyongnamsanTV_DPRK.png","saab tv":"https://i.imgur.com/JEC1J89.png","sabc news":"https://i.imgur.com/H9q3Q9d.png","sahan tv":"https://i.imgur.com/fOvHhX2.png","sahara 24":"https://i.imgur.com/nOkf1fU.png","sama dubai":"https://i.imgur.com/bF6I3N1.jpg","samiaki tv":"https://i.imgur.com/aV5QoNG.png","san marino rtv":"https://i.imgur.com/lJpOlLv.png","san marino rtv sport":"https://i.imgur.com/PGm944g.png","sanctuary pluto tv":"https://i.imgur.com/iYyijeJ.png","sardegna 1":"https://i.imgur.com/YNEW2h2.png","sat sun 18 00 22 00 kst tvg logo https i imgur com hvfpgeh png tvg id sportstelevision kp tvg chno 4 tvg country kp group title north korea sports television not 24 7 sat sun 18 00 22 00 kst":"https://i.imgur.com/HvFpGeH.png","savoir m dia":"https://i.imgur.com/pa4wOVY.png","sbc saudi arabia":"https://i.imgur.com/9JSQglj.png","sbc somalia":"https://i.imgur.com/VLhgTIA.png","sbs food":"https://i.imgur.com/qN9p4h0.png","sbs tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/SBS_Korea_Logo_%28Word_Only%29.svg/500px-SBS_Korea_Logo_%28Word_Only%29.svg.png","sbs viceland":"https://i.imgur.com/WMKCkD0.png","sbs world movies":"https://i.imgur.com/V6hhtCx.png","sbtv":"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/SBTV_Logo.svg/500px-SBTV_Logo.svg.png","scherzi e risate pluto tv":"https://i.imgur.com/kPxGzPI.png","schlager deluxe":"https://i.imgur.com/YPpgUOg.png","sci fi pluto tv":"https://i.imgur.com/5B94N8g.png","scripps news":"https://i.imgur.com/UfN6aAi.png","senato tv":"https://i.imgur.com/FoQoNZW.png","serie pluto tv":"https://i.imgur.com/CHBhRZr.png","servus tv":"https://i.imgur.com/zDWhSxq.png","sesta rete":"https://i.imgur.com/0B0S2gI.png","set tv cilento":"https://i.imgur.com/qN5D1jD.png","settimo cielo pluto tv":"https://i.imgur.com/TC5lo6r.png","seven":"https://i.imgur.com/6zwKJaa.png","shabelle tv":"https://www.lyngsat.com/logo/tv/ss/shabelle-tv-so.png","sharjah sports":"https://i.imgur.com/IaRaabJ.jpg","sharjah tv":"https://www.lyngsat.com/logo/tv/ss/sharjah-tv-ae.png","shorts":"https://i.imgur.com/GwM7RHV.jpg","sicilia 24 tv":"https://i.imgur.com/GhQX36O.png","sicilia tv":"https://i.imgur.com/I5FoThW.png","sienatv":"https://i.imgur.com/gcysky4.png","silverbird news 24":"https://i.imgur.com/ssEAjq5.jpeg","sitel":"https://i.imgur.com/pdobwKt.png","skai tv":"https://i.imgur.com/TSg7B8X.png","sky folk":"https://i.imgur.com/xRw4Hmu.png","sky news arabia":"https://i.imgur.com/SvjU4h6.png","sky news now au":"https://upload.wikimedia.org/wikipedia/en/thumb/d/d0/Sky_News_Australia_logo_%282018%29.svg/500px-Sky_News_Australia_logo_%282018%29.svg.png","sky news uk":"https://d2n0069hmnqmmx.cloudfront.net/epgdata/1.0/newchanlogos/512/512/skychb1404.png","sky news weather":"https://pbs.twimg.com/profile_images/1604994875459518464/lGt2wEqM_400x400.jpg","sky tg24":"https://i.imgur.com/q4d3Dah.png","sl 48 tv":"https://i.imgur.com/b58oouu.jpg","smash tv":"https://i.imgur.com/ZKF0fG3.png","sntv daljir":"https://i.imgur.com/Re3ur88.png","sofy tv":"https://i.imgur.com/fsJFJeZ.png","solotv":"https://i.imgur.com/Ad2ueID.png","somali cable tv":"https://i.imgur.com/iPkaCts.png","somali national tv":"https://upload.wikimedia.org/wikipedia/commons/d/d6/SNTV_REBRANDED_LOGO.png","somaliland national tv":"https://i.imgur.com/FIuQNWN.png","sophia tv":"https://i.imgur.com/fiLNK3b.jpg","sor tv":"https://i.imgur.com/BcfZgD8.png","soundcity tv":"https://i.imgur.com/zfi4SXW.png","south park pluto tv":"https://i.imgur.com/06wIdRV.png","spektrum home":"https://upload.wikimedia.org/wikipedia/commons/2/2d/Spektrum-home.png","spin 103 8":"https://upload.wikimedia.org/wikipedia/commons/2/2e/Spin_400x400.png","sport pluto tv":"https://i.imgur.com/o2psAYW.png","sport2u":"https://i.imgur.com/WW0lNk1.png","sportitalia live24":"https://i.imgur.com/hu56Ya5.png","sportitalia plus":"https://i.imgur.com/hu56Ya5.png","sportitalia solocalcio":"https://i.imgur.com/hu56Ya5.png","sportoutdoor tv":"https://i.imgur.com/fwOuEBl.png","sportska televizija":"https://i.imgur.com/xdxjcVh.png","squadra speciale cobra 11 pluto tv":"https://i.imgur.com/HtDoAF2.png","squirrel":"https://i.imgur.com/urF0kYA.png","srf 1":"https://i.imgur.com/KCPHba2.png","st europe channel":"https://i.imgur.com/QpPgSfr.png","stadium":"https://i.imgur.com/6ae9E8d.png","star":"https://i.imgur.com/Hp0stVQ.png","star channel finland":"https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Star_Channel_2020.svg/500px-Star_Channel_2020.svg.png","star international":"https://i.imgur.com/Hp0stVQ.png","star trek the original series pluto tv":"https://i.imgur.com/VnUrFqB.png","stiletv":"https://i.imgur.com/ZP3cJi7.png","storia pluto tv":"https://i.imgur.com/w5BYvsz.png","stories rakuten tv":"https://i.imgur.com/tMcUvjI.jpg","stryk tv":"https://stryktv.com/wp-content/uploads/2021/08/StrykTV-MTS.png","studio 100":"https://i.imgur.com/z84qFXd.png","stvr 24":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/slovakia/rtvs-24-sk.png","sundom tv":"https://i.imgur.com/WgwR7nJ.png","sundskanalen":"https://i.imgur.com/8uT0p3q.jpg","sunshine 106 8":"https://upload.wikimedia.org/wikipedia/en/9/97/Sunshine_106.8_logo.png","super":"https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d8/Super%21_logo_2015.svg/330px-Super%21_logo_2015.svg.png","super brothers and sisters pluto tv":"https://i.imgur.com/KSQvVye.png","super gaming pluto tv":"https://i.imgur.com/UB7xHRQ.png","super girl power pluto tv":"https://i.imgur.com/lzgp9GM.png","super icarly pluto tv":"https://i.imgur.com/Mhl252U.png","super intervallo pluto tv":"https://i.imgur.com/jl7ZvE5.png","super j tv":"https://i.imgur.com/5oy5Nuu.png","super pop pluto tv":"https://i.imgur.com/jlz31HP.png","super risate pluto tv":"https://i.imgur.com/ALCbqZt.png","super rugrats pluto tv":"https://i.imgur.com/QqMQZte.png","super six":"https://i.imgur.com/kHSuyub.png","super spongebob pluto tv":"https://i.imgur.com/vFiwODM.png","super spyders pluto tv":"https://i.imgur.com/n89yuZh.png","super star pluto tv":"https://i.imgur.com/YLtqPkF.png","super victorious pluto tv":"https://i.imgur.com/ArXLm5R.png","super zoey 101 pluto tv":"https://i.imgur.com/7FCQb1G.png","superscreen tv":"https://i.imgur.com/DuhRy48.png","supertennis":"https://i.imgur.com/GzsPlbX.png","supertoons tv":"https://i.imgur.com/A6vCYsC.png","suryoyo sat":"https://i.imgur.com/naCNjaB.png","suspilne kultura":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/Suspilne_Kultura_%282022%29.svg/500px-Suspilne_Kultura_%282022%29.svg.png","suspilne sport":"https://i.imgur.com/16IhU0M.png","svt 1":"https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/SVT1_logo_2016.svg/960px-SVT1_logo_2016.svg.png","svt 2":"https://i.imgur.com/iB3veGx.png","svt 24":"https://i.imgur.com/o9M7Tiq.png","swr baden w rttemberg":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/SWR_Logo_2023.svg/500px-SWR_Logo_2023.svg.png","swr rheinland pfalz":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/SWR_Logo_2023.svg/500px-SWR_Logo_2023.svg.png","synergy tv":"https://i.imgur.com/ugAy0UG.jpg","syri":"https://i.imgur.com/4zVyj1M.png","syros tv1":"https://i.imgur.com/duXHyvN.png","t l qu bec":"https://i.imgur.com/8grBWK9.png","t l tchad":"https://upload.wikimedia.org/wikipedia/fr/b/b6/Logo_T%C3%A9l%C3%A9_Tchad.png","t sport plus":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/ct-sport-cz.png","t13 en vivo":"https://i.imgur.com/3CEijac.png","taevas tv7":"https://i.imgur.com/usXedIj.png","tagesschau24":"https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Tagesschau24-2012.svg/500px-Tagesschau24-2012.svg.png","taivas tv7":"https://i.imgur.com/a4iNVXA.png","taiwan":"https://i.imgur.com/SfcZyqm.png","taiwanplus":"https://i.imgur.com/SfcZyqm.png","talking pictures tv":"https://i.imgur.com/S1zoIp7.png","tapahtumatv eveo":"https://i.imgur.com/sR8nA8w.png","tbn baltia":"https://i.imgur.com/rKBaK56.png","tbn uk":"https://i.imgur.com/9vzEz1b.png","tcf tv":"https://i.imgur.com/fiylFs2.jpg","tchad 24":"https://www.lyngsat.com/logo/tv/tt/tchad-24-td.png","tdm entertainment":"https://upload.wikimedia.org/wikipedia/commons/6/6c/TDM_Entertainment.png","tdm information":"https://upload.wikimedia.org/wikipedia/zh/9/9b/TDM_Ou_Mun.png","tdm ou mun":"https://upload.wikimedia.org/wikipedia/zh/9/9b/TDM_Ou_Mun.png","tdm sport":"https://upload.wikimedia.org/wikipedia/zh/9/9b/TDM_Ou_Mun.png","teatro tv":"https://i.imgur.com/UsvffQL.png","tec tv":"https://i.imgur.com/EGCq1wc.png","teen mom pluto tv":"https://i.imgur.com/LdiTgeW.png","teenage mutant ninja turtles pluto tv":"https://i.imgur.com/bAnyjH7.png","tele a":"https://i.imgur.com/l7Za9KH.jpg","tele abruzzo tv":"https://i.imgur.com/koB8J4b.jpg","tele acras":"https://i.imgur.com/90Lsv8q.png","tele arena":"https://i.imgur.com/9hsoWMO.png","tele bari":"https://i.imgur.com/HYSz4rx.png","tele belluno":"https://i.imgur.com/YiM2Z7E.png","tele boario":"https://i.imgur.com/LlLD3L6.png","tele bruzzano":"https://i.imgur.com/7TWbCDt.jpg","tele chiara":"https://i.imgur.com/Q5XpnXR.png","tele club italia":"https://i.imgur.com/WxkOgg0.png","tele cupole":"https://i.imgur.com/ZmUI9zb.png","tele estense":"https://i.imgur.com/X7i7DWo.png","tele foggia":"https://i.imgur.com/M7tqBu9.jpg","tele friuli":"https://i.imgur.com/AoQxZxD.png","tele gela":"https://i.imgur.com/sjrxbgP.png","tele golfo rtg":"https://hostux.pics/images/2026/09/11/23_tele_golfo_rtg82613af55dc2f27c.png","tele granducato":"https://hostux.pics/images/2026/09/11/24_tele_granducatod50b05fad56debe8.png","tele ischia":"https://i.imgur.com/vihHVQn.jpg","tele jonio":"https://i.imgur.com/qJeDV8R.png","tele lacco ameno":"https://hostux.pics/images/2026/09/11/25_tele_lacco_ameno054250ed4a5ba4e2.png","tele laser":"https://hostux.pics/images/2026/09/11/26_tele_lasera82328430bd5c30c.png","tele liberta hd":"https://i.imgur.com/XzAB5k7.jpg","tele liguria sud":"https://i.imgur.com/BeLAYJ6.jpg","tele mantova":"https://i.imgur.com/bkSPcs4.png","tele mia":"https://i.imgur.com/SdXpCwL.png","tele mia extra":"https://i.imgur.com/upzBG32.png","tele mistretta":"https://i.imgur.com/OJ3zUS0.png","tele molise":"https://i.imgur.com/u5VD0x9.png","tele nord genova":"https://i.imgur.com/I6yegEK.png","tele nostra":"https://i.imgur.com/FACahKZ.png","tele occidente":"https://i.imgur.com/3aOiWKa.png","tele oltre":"https://i.imgur.com/PxtJAxs.png","tele one":"https://i.imgur.com/9trB6mj.png","tele pace trento":"https://i.imgur.com/o5sQCpF.png","tele pavia":"https://i.imgur.com/YVodo4T.png","tele pegaso":"https://i.imgur.com/FQkM8Vd.png","tele piadena":"https://i.imgur.com/VqaPuQN.png","tele pordenone":"https://i.imgur.com/dbYwXwg.png","tele quattro trieste":"https://i.imgur.com/MFxQxve.png","tele radio ercolano":"https://i.imgur.com/YPuoy8N.jpg","tele radio orte":"https://i.imgur.com/uX2uxvN.png","tele radio pace 1":"https://i.imgur.com/ORkkXM8.png","tele radio pace 2":"https://i.imgur.com/U4E3eEr.png","tele radio pace 3":"https://i.imgur.com/pTqIxFD.png","tele radio pace 4":"https://i.imgur.com/KPHHsN5.png","tele radio sciacca":"https://i.imgur.com/suhz5mE.png","tele ritmo":"https://hostux.pics/images/2026/09/11/27_tele_ritmo751eb955cbd7dec7.png","tele sirio":"https://i.imgur.com/mDN6QX1.png","tele spazio messina":"https://i.imgur.com/Io5w6lT.png","tele stabia gigli tv":"https://hostux.pics/images/2026/09/11/28_tele_stabia_gigli_tv41f3f911222a7901.png","tele sud puglia":"https://i.imgur.com/fqTLtvs.png","tele tricolore":"https://i.imgur.com/A2XouAd.png","tele tutto":"https://i.imgur.com/sZxMP7g.png","tele tutto 2":"https://i.imgur.com/mxXbMaw.png","tele tutto 24":"https://i.imgur.com/weKWQgx.png","tele venezia":"https://i.imgur.com/SavGpCE.jpg","tele video agrigento t v a":"https://i.imgur.com/AaPr63E.png","tele8 tv":"https://i.imgur.com/dM0HE6O.png","teleambiente":"https://i.imgur.com/jxZcQhU.png","telecampione":"https://i.imgur.com/LhjwmME.png","telecinco":"https://i.imgur.com/JECsKdk.png","telecitt padova":"https://i.imgur.com/xvVgEaA.jpg","telecity lombardia":"https://i.imgur.com/ECvJ3ZD.jpeg","telecity piemonte":"https://i.imgur.com/CrlzHjv.jpeg","telecity valle d aosta":"https://i.imgur.com/T9EsAOX.jpeg","telecolor":"https://i.imgur.com/urUG78J.png","telecolor sicilia":"https://i.imgur.com/rfNg6fw.png","telecolore salerno":"https://i.imgur.com/3vBq2g2.png","telecostasmeralda":"https://i.imgur.com/QLqkbss.png","telefe":"https://i.imgur.com/wrZfMXn.png","teleformula":"https://i.imgur.com/jR6taXt.png","telegenova":"https://i.imgur.com/D6HC0So.png","teleiblea":"https://i.imgur.com/n1THygZ.png","teleitalia 41":"https://i.imgur.com/lTuPSOn.png","telejato":"https://i.imgur.com/r3Dqzdj.png","telekanal rai":"https://i.imgur.com/Ouv51WB.png","teleleonessa":"https://i.imgur.com/jq3etlV.png","telemadrid":"https://upload.wikimedia.org/wikipedia/commons/thumb/7/71/TeleMadrid.svg/500px-TeleMadrid.svg.png","telemajg":"https://i.imgur.com/9tefonp.jpg","telemax":"https://i.imgur.com/gfX0hdB.png","telenorba":"https://upload.wikimedia.org/wikipedia/it/thumb/2/28/Telenorba_-_Logo_2014.svg/500px-Telenorba_-_Logo_2014.svg.png","telenova":"https://i.imgur.com/x41IkJK.png","teleradiostereo":"https://i.imgur.com/eRNgqnA.png","telerama":"https://i.imgur.com/enfqUlI.jpg","teleregione":"https://i.imgur.com/i5WozUP.png","teleregione color":"https://i.imgur.com/vi5Nf3S.png","teleregione live":"https://i.imgur.com/DBrt8L3.png","telerent 7gold":"https://i.imgur.com/YZadq0M.png","telereporter":"https://i.imgur.com/WIo6SPc.png","teleroma 56":"https://i.imgur.com/wGfpUj8.png","teleromadue":"https://i.imgur.com/78hA7ma.png","teleromagna":"https://i.imgur.com/4jWadI8.png","teleromagna 24":"https://i.imgur.com/Bpml478.png","telestar1":"https://i.imgur.com/UZQjEsd.png","telesud trapani":"https://i.imgur.com/tpZvU1P.png","telesur":"https://upload.wikimedia.org/wikipedia/commons/8/82/TeleSUR.png","telesveva":"https://i.imgur.com/SCDETZC.jpeg","teleticino":"https://i.imgur.com/zm2ruqz.png","teletubbies":"https://i.imgur.com/tSw1oON.jpeg","teleuniverso":"https://i.imgur.com/u8E9wBb.png","televallo trapani":"https://i.imgur.com/P6zuiRH.png","televen":"https://upload.wikimedia.org/wikipedia/commons/c/c0/Televen_logo.PNG","televisa telenovelas":"https://i.imgur.com/GaJIRN3.jpg","televisi n canaria":"https://i.imgur.com/68LNS8e.png","televisi n p blica":"https://i.imgur.com/4hYYpiu.png","televizija 5":"https://i.imgur.com/znpvJys.png","televizija republike srpske rtrs":"https://i.imgur.com/2Sgs5gM.png","televizija slavonije i baranje stv":"https://upload.wikimedia.org/wikipedia/hr/0/04/STV.PNG","televizija zapad":"https://upload.wikimedia.org/wikipedia/hr/9/97/TVZ-2018.png","tg norba 24":"https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Tg_norba24.png/500px-Tg_norba24.png","tgcom 24":"https://i.imgur.com/xautVD8.png","tgs telegiornale di sicilia":"https://hostux.pics/images/2026/09/11/29_tgs_telegiornale_di_sicilia6c915db0091ed7a6.png","the asylum":"https://i.imgur.com/rOxQfdG.png","the asylum pluto tv":"https://i.imgur.com/S2jlaiJ.png","the boat show":"https://i.imgur.com/cPTLian.png","the boat show pluto tv":"https://i.imgur.com/aDcwRvj.png","the guardian":"https://i.imgur.com/o9AYq9V.png","the hills pluto tv":"https://i.imgur.com/9SRojGx.png","the pet collective":"https://i.imgur.com/daTU44g.jpeg","the pet collective pluto tv":"https://i.imgur.com/034PrSz.png","the shopping channel":"https://i.imgur.com/PEdXHSE.png","the weather network":"https://upload.wikimedia.org/wikipedia/en/thumb/b/bf/TWN_Logo_2011.svg/1920px-TWN_Logo_2011.svg.png","thessalia":"https://i.imgur.com/KXz67LY.png","thikrayat":"https://i.imgur.com/AKa1X9d.png","thriller rakuten tv":"https://i.imgur.com/jJTnBNk.jpeg","ticker news":"https://i.imgur.com/z7M0QxV.png","tingvarp":"https://upload.wikimedia.org/wikipedia/commons/9/90/Logo_-_L%C3%B8gting.png","tipik":"https://i.imgur.com/PVbVj8o.png","tirol tv":"https://i.imgur.com/1E7Nflo.jpg","tjb tv":"https://i.imgur.com/q9Nx801.png","tlc finland":"https://i.imgur.com/0d5hP3A.png","tlt molise":"https://i.imgur.com/wgwD7gh.png","tn live":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/nova-cz.png","tn todo noticias":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/TN_todo_noticias_logo.svg/250px-TN_todo_noticias_logo.svg.png","tnt kids":"https://i.imgur.com/irTDbpn.png","today fm":"https://upload.wikimedia.org/wikipedia/commons/b/bf/Today_FM_Logo_2017.jpg","together tv":"https://upload.wikimedia.org/wikipedia/en/thumb/c/ce/Together_TV_logo.svg/500px-Together_TV_logo.svg.png","tokyo mx":"https://channel.rakuten.co.jp/service/img/logo/chlogo-with-number/108_mx.png","top calcio 24":"https://i.imgur.com/DnVPKPE.png","top crime":"https://i.imgur.com/RFIwv9O.png","top gear pluto tv":"https://i.imgur.com/ZZo7DXQ.png","top news":"https://i.imgur.com/tBAXkOW.png","toronto 360 tv":"https://i.imgur.com/PkWndsv.png","tot pluto tv":"https://i.imgur.com/wLDteJZ.png","trace latina":"https://i.imgur.com/GHbz8wd.png","trace urban":"https://i.imgur.com/PAx9qj8.png","travel tv":"https://i.imgur.com/aXAUyLN.png","trc santeramo":"https://i.imgur.com/VbYdS8P.jpg","tremedia tv":"https://i.imgur.com/dqRV1ff.jpeg","trend tv":"https://upload.wikimedia.org/wikipedia/hr/2/22/TrendTV.jpg","trentino tv":"https://i.imgur.com/ROKOCR2.png","trg media":"https://hostux.pics/images/2026/09/11/30_trg_media50fbce3fd42ecedb.png","trinity tv":"https://i.imgur.com/prgVynR.jpg","trl tele radio leo":"https://i.imgur.com/qAagkJT.png","trm h24":"https://i.imgur.com/d47CdYU.png","tropoja":"https://i.imgur.com/D3hNOVS.png","trsp tele radio san pietro":"https://hostux.pics/images/2026/09/11/31_trsp_tele_radio_san_pietroe201f062394d1eaa.png","trt 1":"https://i.imgur.com/j786OLG.png","trt 2":"https://i.imgur.com/lNWrOE2.png","trt arabi":"https://i.imgur.com/yyhWOZs.png","trt avaz":"https://i.imgur.com/VhTwXu5.png","trt belgesel":"https://i.imgur.com/MGO87pe.png","trt eba ilkokul":"https://i.imgur.com/wDvZfk8.png","trt eba lise":"https://i.imgur.com/IebUZx1.png","trt eba ortaokul":"https://i.imgur.com/yfPTvRx.png","trt haber":"https://i.imgur.com/OVfo8Ab.png","trt kurd":"https://i.imgur.com/6BpymfB.png","trt m zik":"https://i.imgur.com/fIVFCEd.png","trt ocuk":"https://i.imgur.com/QLFmD6d.png","trt spor":"https://i.imgur.com/N2wGZyf.png","trt spor 2":"https://i.imgur.com/ysKteM8.png","trt t rk":"https://i.imgur.com/OSTOQNw.png","true crime":"https://raw.githubusercontent.com/dp247/mediaportal-uk-logos/master/TV/True-Crime-UK.png","tsd tv arezzo tele san domenico":"https://i.imgur.com/WQ8eQXc.png","tsn tele sondrio news":"https://i.imgur.com/24Anl5o.png","ttv main channel":"https://upload.wikimedia.org/wikipedia/zh/4/43/TTV_Home_Channel_with_HD_2016.png","ttv news":"https://upload.wikimedia.org/wikipedia/zh/3/3f/TTV_News_Channel_with_HD_2016.png","turbo":"https://i.imgur.com/TjjVjV0.png","turkmeneli tv":"https://i.imgur.com/iUhhg4B.png","tuscia sabina 2000tv":"https://i.imgur.com/Tq5nEAy.png","tv 100":"https://i.imgur.com/9rtf8OR.png","tv 12":"https://i.imgur.com/oxv08pJ.png","tv 2 bornholm":"https://i.imgur.com/cEOpXU6.png","tv 2 fyn":"https://i.imgur.com/4L6AIMH.png","tv 2 nord":"https://i.imgur.com/tEJ22UW.png","tv 2 st":"https://i.imgur.com/H9l6Ulw.png","tv 2 stjylland":"https://i.imgur.com/qEUXjHp.png","tv 2000":"https://i.imgur.com/x7RaK3a.png","tv 2020":"https://i.imgur.com/rtfsNdd.png","tv 21":"https://i.imgur.com/IC1f4h3.png","tv 7 albania":"https://i.imgur.com/k9WqPLZ.png","tv alsace":"https://i.imgur.com/zaJDEOv.png","tv apollon":"https://i.imgur.com/gUz2AjM.png","tv bpk":"https://upload.wikimedia.org/wikipedia/en/d/df/Logo_of_RTV_BPK_Gora%C5%BEde.jpg","tv brics chinese":"https://i.imgur.com/896132Z.png","tv c mara":"https://i.imgur.com/UpV2PRk.png","tv campi flegrei":"https://i.imgur.com/9d2K1nX.png","tv chile":"https://i.imgur.com/yCL888l.png","tv dalmacija":"https://upload.wikimedia.org/wikipedia/hr/b/ba/Televizija_dalmacija_logo.jpg","tv eger":"https://i.imgur.com/GUVW073.png","tv j rmala":"https://i.imgur.com/tQHkHD0.png","tv jadran":"https://upload.wikimedia.org/wikipedia/hr/9/9a/Tv_jadran_logo.png","tv luna napoli":"https://i.imgur.com/jxhuoyE.png","tv marche":"https://i.imgur.com/vxgbFnR.png","tv midt vest":"https://i.imgur.com/OU7xIVa.png","tv monaco":"https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/TVMonaco_2023.svg/330px-TVMonaco_2023.svg.png","tv mulhouse":"https://i.imgur.com/4esQG8H.png","tv pirveli":"https://i.imgur.com/cGHsM1x.png","tv prato":"https://i.imgur.com/zDeVpZd.png","tv qui modena":"https://i.imgur.com/4bOYlfg.png","tv rete7":"https://i.imgur.com/FXFzJhM.png","tv syd":"https://i.imgur.com/k2jf591.png","tv umbria":"https://i.imgur.com/DASRCe2.png","tv universidad":"https://i.imgur.com/tvLHiAT.png","tv uno":"https://i.imgur.com/OtCwYsh.jpg","tv yes":"https://i.imgur.com/1wsO8U7.png","tv3cat":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/TV3CAT.svg/500px-TV3CAT.svg.png","tv5 finland":"https://i.imgur.com/MoukyGs.png","tv5 monde":"https://i.imgur.com/7WHwYK3.png","tv5 monde europe":"https://i.imgur.com/uPmwTo9.png","tv5 monde fbs":"https://i.imgur.com/uPmwTo9.png","tv5 monde info":"https://i.imgur.com/NcysrWH.png","tv7 b k scsaba":"https://i.imgur.com/G9Ib5K3.png","tv9 bharatvarsh":"https://upload.wikimedia.org/wikipedia/en/thumb/a/a6/TV9_Bharatvarsh.svg/500px-TV9_Bharatvarsh.svg.png","tv9 kannada":"https://i.imgur.com/9rBgkxG.png","tv9 marathi":"https://i.imgur.com/k7urrIv.jpeg","tv9 telugu":"https://i.imgur.com/oHAdC30.png","tva vicenza":"https://i.imgur.com/FtFuPCC.png","tvb finance sports information channel":"https://i.imgur.com/Fkkp7x7.png","tvb news channel":"https://i.imgur.com/Gwij0Fj.png","tvc news":"https://i.imgur.com/jaSq18B.png","tvcg 1":"https://i.imgur.com/QORHrXu.png","tvcg 2":"https://i.imgur.com/WECmUKH.png","tvcg 3":"https://i.imgur.com/XC7zVog.png","tvcg mne":"https://i.imgur.com/pf8VEwf.png","tve internacional europe asia":"https://i.imgur.com/ow1HArj.png","tve rs":"https://upload.wikimedia.org/wikipedia/commons/c/c2/Logotipo_da_TVE_RS.png","tvl tv libera pistoia":"https://i.imgur.com/07geF0L.png","tvm 3":"https://i.imgur.com/3v6iZE6.png","tvm palermo":"https://i.imgur.com/uqOdAXB.png","tvn 3":"https://i.imgur.com/84lWqRi.png","tvr 1":"https://i.imgur.com/CKQ7mpB.png","tvr 2":"https://upload.wikimedia.org/wikipedia/commons/4/4c/TVR_2_2022_logo.png","tvr 3":"https://upload.wikimedia.org/wikipedia/commons/0/0d/TVR3_2022.png","tvr cluj":"https://i.imgur.com/8DqsGHO.png","tvr craiova":"https://i.imgur.com/vxWbQiy.png","tvr ia i":"https://i.imgur.com/Kxkihds.png","tvr info":"https://i.imgur.com/7oE7ThR.png","tvr international":"https://i.imgur.com/AlW8jyl.png","tvr moldova":"https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/TVR_Moldova_Logo_2022.svg/500px-TVR_Moldova_Logo_2022.svg.png","tvr t rgu mure":"https://i.imgur.com/9Hptdqj.png","tvr timi oara":"https://i.imgur.com/Db3DV6H.png","tvr xenon":"https://i.imgur.com/kLzW1Pf.jpg","tvrs tv":"https://i.imgur.com/6p7hTmY.jpg","tvsn":"https://i.imgur.com/p3QCBOo.png","ubc tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Ubc_logo2.svg/500px-Ubc_logo2.svg.png","uchile tv":"https://i.imgur.com/mF2W8Uh.png","ucv televisi n":"https://i.imgur.com/2VL4Pts.png","ultimate classic wrestling pluto tv":"https://i.imgur.com/QVN5qv3.png","umbria trt":"https://i.imgur.com/CU6BBgs.png","umbria tv":"https://i.imgur.com/XKCVEmK.png","unbeaten sports pluto tv":"https://i.imgur.com/UAiv612.png","unicanal":"https://i.imgur.com/brlepuX.png","uninettuno university tv":"https://i.imgur.com/BOGMeio.png","uno tv":"https://i.imgur.com/4PNbqqL.png","uno4 tv":"https://i.imgur.com/wfPPpBA.png","usa today":"https://i.imgur.com/37K0AZX.png","v chodocesk tv":"https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/czech-republic/tv-v1-cz.png","v s rhelyi telev zi":"https://i.imgur.com/WOEqdmx.png","v stmanlands tv":"https://i.imgur.com/EXBaQ88.jpg","vale tv":"https://upload.wikimedia.org/wikipedia/commons/9/98/Logo_de_VALE_TV.png","vb33":"https://i.imgur.com/ygDuIxU.png","venevisi n":"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Venevisi%C3%B3n2007.svg/500px-Venevisi%C3%B3n2007.svg.png","vera tv":"https://i.imgur.com/djMvkvN.png","vergina":"https://i.imgur.com/cpF6wvR.png","vevo pop":"https://i.imgur.com/DPqMpQC.png","vh1 back to 90 s pluto tv":"https://i.imgur.com/vGgh3cs.png","vh1 canzoni italiane pluto tv":"https://i.imgur.com/fpQBKP2.png","vh1 girl power pluto tv":"https://i.imgur.com/Z4t6fdU.png","vh1 hip hop rap pluto tv":"https://i.imgur.com/k1zQpiO.png","vh1 music legends pluto tv":"https://i.imgur.com/kJ1MDVi.png","vh1 rock pluto tv":"https://i.imgur.com/P1OCuFl.png","viaggi pluto tv":"https://i.imgur.com/3GJg0uy.png","viaplay tv":"https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Viaplay_TV_logo.svg/500px-Viaplay_TV_logo.svg.png","viasat 6":"https://i.imgur.com/kypSbFX.png","video calabria":"https://i.imgur.com/Bc2AvIm.png","video mediterraneo":"https://i.imgur.com/hJHC3uQ.png","video nola":"https://i.imgur.com/M5z5UoD.jpg","video regione sicilia":"https://i.imgur.com/0szwnR3.png","video star tv sicilia":"https://i.imgur.com/1ddJVZ7.jpg","video touring tv":"https://i.imgur.com/E2Feao5.jpg","videonovara":"https://i.imgur.com/NnO7E5I.png","videotelecarnia":"https://i.imgur.com/r4K9JHW.png","vidusdaugavas telev zija":"https://i.imgur.com/L5U3PQR.png","vintage radio tv":"https://i.imgur.com/n3LtBNT.jpg","virgin media 1":"https://upload.wikimedia.org/wikipedia/en/thumb/4/4a/Virgin_Media_One_logo_2018.svg/960px-Virgin_Media_One_logo_2018.svg.png","virgin media 2":"https://upload.wikimedia.org/wikipedia/en/thumb/c/c5/Virgin_Media_Two_logo_2018.svg/960px-Virgin_Media_Two_logo_2018.svg.png","virgin media 3":"https://upload.wikimedia.org/wikipedia/en/thumb/2/2f/Virgin_Media_Three_logo_2018.svg/960px-Virgin_Media_Three_logo_2018.svg.png","virgin media 4":"https://i.imgur.com/x4VsyIm.png","virgin radio tv":"https://i.imgur.com/7Im3HI1.png","vitebsk telekanal":"https://i.imgur.com/FXAqELU.jpg","vizion plus":"https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Vizion_Plus.svg/500px-Vizion_Plus.svg.png","vocea basarabiei":"https://i.imgur.com/irP8QLs.png","vouli tv":"https://i.imgur.com/1vqW7lc.png","vuemme tv":"https://i.imgur.com/x5A0xU6.png","w r tv":"https://i.imgur.com/P9O1jo0.png","waffi tv":"https://i.imgur.com/ejlCb5g.png","wanasah":"https://i.imgur.com/nLtiXNf.png","wazobia max tv nigeria":"https://i.imgur.com/sEnLR0B.jpeg","wazobia max tv port harcourt":"https://i.imgur.com/sEnLR0B.jpeg","weathernation":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/WeatherNation_Logo.svg/500px-WeatherNation_Logo.svg.png","webcom tv":"https://i.imgur.com/KLwj2vj.png","welt":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Welt_TV_Logo_2016.svg/500px-Welt_TV_Logo_2016.svg.png","western pluto tv":"https://i.imgur.com/6vmgQBl.png","wltv":"https://i.imgur.com/aL8jKtU.png","world poker tour pluto tv":"https://i.imgur.com/AF1ON8u.png","wowow":"https://www.lyngsat.com/logo/tv/ww/wowow_live.png","x z r x b r":"https://i.imgur.com/AuB8bnq.png","xsport":"https://i.imgur.com/CHDcfrT.png","yahoo finance":"https://i.imgur.com/43oHsHL.png","yamato animation":"https://i.imgur.com/rOl7HfS.png","yle teema fem":"https://i.imgur.com/iDljufz.png","yle tv1":"https://i.imgur.com/6yXZwUL.png","yle tv2":"https://i.imgur.com/4xkc6PL.png","ylex studio live":"https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/YleX.svg/500px-YleX.svg.png","yu gi oh pluto tv":"https://i.imgur.com/rmzSC1C.png","yvii tv":"https://i.imgur.com/yP5AvDo.png","zagros tv":"https://i.imgur.com/UjIuIQX.png","zalaegerszeg tv":"https://zegtv.hu/wp-content/themes/assembly/images/zegtv-logo.png","zdfinfo":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/ZDFinfo_2011.svg/500px-ZDFinfo_2011.svg.png","zdfneo":"https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/ZDFneo2017_Logo.svg/500px-ZDFneo2017_Logo.svg.png","zdi v rosi tv":"https://i.imgur.com/5cOpdRp.jpg","zee news":"https://i.imgur.com/lmgtjqw.jpeg","zerouno tv music":"https://i.imgur.com/r74lqW8.png","zerouno tv news":"https://i.imgur.com/vxRzyjE.png"};
// W121ZLOGO174B: conservative exact-channel-ID artwork override for Stream TV US.
// Presentation-only; no channel streams, program schedules, favorites or routes altered.
// Ambiguous, suspicious-image-host and missing-logo entries are deliberately excluded.
const w174bStremTvExactLogos: Readonly<Record<string, string>> = {
  "stremtv-us:30ADarcizzleOffshore.us": "https://i.imgur.com/Q4l2uao.png",
  "stremtv-us:30AGolfKingdom.us": "https://i.imgur.com/Lv53nh4.png",
  "stremtv-us:30AInvestmentPitch.us": "https://i.imgur.com/CKCtZo7.png",
  "stremtv-us:30AMusic.us": "https://i.imgur.com/gNWg9tl.png",
  "stremtv-us:30ASidewalks.us": "https://i.imgur.com/HSdwqZN.png",
  "stremtv-us:30ATheBeachShow.us": "https://i.imgur.com/0j5Aget.png",
  "stremtv-us:ABCNewsLive.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive1.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive10.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive2.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive3.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive4.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive5.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive6.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive7.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive8.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABCNewsLive9.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/ABC_News_Live_logo_2021.svg/960px-ABC_News_Live_logo_2021.svg.png",
  "stremtv-us:ABHPTV.us": "https://i.imgur.com/QznvBD7.png",
  "stremtv-us:ABNAfghanistan.us": "https://i.imgur.com/LI30mAt.png",
  "stremtv-us:ABNAfrica.us": "https://i.imgur.com/SLrX8Ef.png",
  "stremtv-us:ABNBibleMoviesChannel.us": "https://i.imgur.com/NCqZdaL.png",
  "stremtv-us:ABNChina.us": "https://i.imgur.com/zagVLQH.png",
  "stremtv-us:ABNUrdu.us": "https://i.imgur.com/Y9ScPIl.png",
  "stremtv-us:ACCDigitalNetwork.us": "https://i.imgur.com/V6Kaqha.png",
  "stremtv-us:ACECountryRadio.us": "https://i.imgur.com/iPtuku6.png",
  "stremtv-us:ACTV.us": "https://i.imgur.com/Z6lB0Ww.png",
  "stremtv-us:AE.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/A%26E_Network_logo.svg/960px-A%26E_Network_logo.svg.png",
  "stremtv-us:AELatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/A%26E_Network_logo.svg/960px-A%26E_Network_logo.svg.png",
  "stremtv-us:AFTV.us": "https://i.imgur.com/UoiUwFj.png",
  "stremtv-us:AKCTV.us": "https://i.imgur.com/XRTfoSp.png",
  "stremtv-us:AKCTVMeettheBreeds.us": "https://i.imgur.com/66avgdk.png",
  "stremtv-us:AKCTVPuppies.us": "https://i.imgur.com/2nzRS60.png",
  "stremtv-us:ALLBLKGems.us": "https://i.imgur.com/gnkepQJ.png",
  "stremtv-us:AMC.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/AMC_logo_2019.svg/960px-AMC_logo_2019.svg.png",
  "stremtv-us:AMCLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/AMC_logo_2019.svg/960px-AMC_logo_2019.svg.png",
  "stremtv-us:AMCenEspanol.us": "https://i.imgur.com/L1h6W5Q.png",
  "stremtv-us:AMGATV.us": "https://i.imgur.com/NTlC6e7.png",
  "stremtv-us:AMGTV.us": "https://i.imgur.com/m5Anun9.png",
  "stremtv-us:AMP1.us": "https://i.imgur.com/3ZhrthD.png",
  "stremtv-us:AMP2.us": "https://i.imgur.com/nfur3FR.png",
  "stremtv-us:ARTFLIXMovieClassics.us": "https://i.imgur.com/5pOZQB4.png",
  "stremtv-us:ATL26.us": "https://i.imgur.com/s4fqNMt.png",
  "stremtv-us:ATVSat.us": "https://i.imgur.com/pwM5txv.png",
  "stremtv-us:ATXN1.us": "https://i.imgur.com/tSMtDlz.png",
  "stremtv-us:ATXN2.us": "https://i.imgur.com/tSMtDlz.png",
  "stremtv-us:ATXN3.us": "https://i.imgur.com/tSMtDlz.png",
  "stremtv-us:AWE.us": "https://i.imgur.com/OjpCtGj.png",
  "stremtv-us:AWEInternational.us": "https://i.imgur.com/VhxtMUQ.png",
  "stremtv-us:AXNAdria.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/AXN_logo_%282015%29.svg/960px-AXN_logo_%282015%29.svg.png",
  "stremtv-us:AXNBlack.us": "https://i.imgur.com/Peo1QiZ.png",
  "stremtv-us:AXNLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/AXN_logo_%282015%29.svg/960px-AXN_logo_%282015%29.svg.png",
  "stremtv-us:AXSTV.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/AXS_TV_logo.svg/960px-AXS_TV_logo.svg.png",
  "stremtv-us:AbsoluteRealitybyWETV.us": "https://i.imgur.com/Gtwk8ic.png",
  "stremtv-us:AccessHumboldt.us": "https://i.imgur.com/tJl43uM.png",
  "stremtv-us:AccessNashua.us": "https://i.imgur.com/iv9Vfcb.png",
  "stremtv-us:AccessVisionChannel16.us": "https://i.imgur.com/vi4TCdb.png",
  "stremtv-us:AccessVisionChannel17.us": "https://i.imgur.com/vi4TCdb.png",
  "stremtv-us:AccuWeatherNOW.us": "https://i.imgur.com/M8wbVYK.png",
  "stremtv-us:AdultSwim.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Adult_Swim_2003_logo.svg/960px-Adult_Swim_2003_logo.svg.png",
  "stremtv-us:AdultSwimLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Adult_Swim_2003_logo.svg/960px-Adult_Swim_2003_logo.svg.png",
  "stremtv-us:AfroLandTV.us": "https://i.imgur.com/jvnkrEF.png",
  "stremtv-us:AlFadyTV.us": "https://i.imgur.com/7L0l0iY.png",
  "stremtv-us:AlHayatTV.us": "https://i.imgur.com/M8ZuzeB.png",
  "stremtv-us:AlHorreyaTV.us": "https://i.imgur.com/EK75DMJ.png",
  "stremtv-us:AlMahdiTV.us": "https://i.imgur.com/S1YM83i.png",
  "stremtv-us:AlkarmaTVAustralia.us": "https://i.imgur.com/90ykspa.png",
  "stremtv-us:AlkarmaTVFamily.us": "https://i.imgur.com/yUEuQA2.png",
  "stremtv-us:AlkarmaTVMiddleEast.us": "https://i.imgur.com/6OmNw5A.png",
  "stremtv-us:AlkarmaTVNorthAmericaCanada.us": "https://i.imgur.com/pnm60bq.png",
  "stremtv-us:AlkarmaTVPraise.us": "https://i.imgur.com/bJLKkou.png",
  "stremtv-us:AlkarmaTVTalmazaDiscipleship.us": "https://i.imgur.com/t2ZkRbr.png",
  "stremtv-us:AlkarmaTVYouthEnglish.us": "https://i.imgur.com/kpuO8m7.png",
  "stremtv-us:AlmagdTVMiddleEast.us": "https://i.imgur.com/3pUik3b.png",
  "stremtv-us:AlmagdTVNorthAmerica.us": "https://i.imgur.com/3pUik3b.png",
  "stremtv-us:AlwaysFunnyVideos.us": "https://i.imgur.com/vfdN5Xl.png",
  "stremtv-us:AmericanHeroesChannel.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/American_Heroes_Channel_logo.svg/960px-American_Heroes_Channel_logo.svg.png",
  "stremtv-us:AmericanNinjaWarrior.us": "https://raw.githubusercontent.com/RoqueDJ/iptv-svg/main/1792421696158.png",
  "stremtv-us:AmericasTestKitchen.us": "https://i.imgur.com/prMkTsZ.png",
  "stremtv-us:AmuTV.us": "https://i.imgur.com/KXdvPum.png",
  "stremtv-us:AngerManagementChannel.us": "https://i.imgur.com/VXZgrNy.png",
  "stremtv-us:AnimalPlanet.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/2018_Animal_Planet_logo.svg/960px-2018_Animal_Planet_logo.svg.png",
  "stremtv-us:AnimalPlanetLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/2018_Animal_Planet_logo.svg/960px-2018_Animal_Planet_logo.svg.png",
  "stremtv-us:AnimexHIDIVE.us": "https://i.imgur.com/v0BlxCa.png",
  "stremtv-us:AntiquesRoadTrip.us": "https://i.imgur.com/kkm7VqV.png",
  "stremtv-us:AntiquesRoadshowUK.us": "https://i.imgur.com/rKWLv48.png",
  "stremtv-us:AreWeThereYet.us": "https://i.imgur.com/3BJQiHP.png",
  "stremtv-us:AsianCrush.us": "https://i.imgur.com/hW6z1RG.png",
  "stremtv-us:AsianCultureTV.us": "https://i.imgur.com/o1icKZu.png",
  "stremtv-us:AtHomewithFamilyHandyman.us": "https://i.imgur.com/WfKlGbX.png",
  "stremtv-us:AtlantaChannel.us": "https://i.imgur.com/MOGQAns.png",
  "stremtv-us:AvangTV.us": "https://i.imgur.com/3I1n7fO.png",
  "stremtv-us:BATVEducationalChannel.us": "https://i.imgur.com/eDoJqtg.png",
  "stremtv-us:BATVGovernmentChannel.us": "https://i.imgur.com/4MdSstx.png",
  "stremtv-us:BATVPublicChannel.us": "https://i.imgur.com/zKQMDsu.png",
  "stremtv-us:BBCFood.us": "https://i.imgur.com/kcmHcSx.png",
  "stremtv-us:BBCHomeGarden.us": "https://i.imgur.com/rC0pi1D.png",
  "stremtv-us:BEKNews.us": "https://i.imgur.com/m80uxdz.png",
  "stremtv-us:BHTV10.us": "https://i.imgur.com/NRrJ6xb.png",
  "stremtv-us:BHTV35.us": "https://i.imgur.com/3Gqc5f2.png",
  "stremtv-us:BMCHDTV.us": "https://i.imgur.com/c9LiTz0.png",
  "stremtv-us:BPXTVRadio.us": "https://i.imgur.com/86VXni8.jpeg",
  "stremtv-us:BUTV10.us": "https://i.imgur.com/Iv1Fe67.png",
  "stremtv-us:BabySharkTV.us": "https://i.imgur.com/SbBKr8L.png",
  "stremtv-us:Backstage.us": "https://i.imgur.com/qcTNvNU.png",
  "stremtv-us:Baywatch.us": "https://i.imgur.com/c2esKHg.png",
  "stremtv-us:BeachTVFloridaAlabama.us": "https://i.imgur.com/weypM9C.png",
  "stremtv-us:BeachTVKeyWestFloridaKeys.us": "https://i.imgur.com/XhDBdff.png",
  "stremtv-us:BeachTVMyrtleBeachTheGrandStrand.us": "https://i.imgur.com/aLYz7Bv.png",
  "stremtv-us:BeachTVPanamaCity.us": "https://i.imgur.com/HCQDvEe.png",
  "stremtv-us:BerksCommunityTV.us": "https://i.imgur.com/vQ6a4VL.png",
  "stremtv-us:BestofBATVChannel.us": "https://i.imgur.com/TUMiKCX.png",
  "stremtv-us:BetterHealthTV.us": "https://i.imgur.com/qnwJiji.png",
  "stremtv-us:BetterLifeNatureChannel.us": "https://i.imgur.com/D8Vuw6I.png",
  "stremtv-us:BigTenNetwork.us": "https://upload.wikimedia.org/wikipedia/en/thumb/3/39/Big_Ten_Network_Logo.svg/960px-Big_Ten_Network_Logo.svg.png",
  "stremtv-us:BilliardTV.us": "https://i.imgur.com/BZijfKh.png",
  "stremtv-us:Binge.us": "https://i.imgur.com/kEETRln.png",
  "stremtv-us:BlackNewsChannel.us": "https://i.imgur.com/oX5oR4d.png",
  "stremtv-us:Boomerang.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Boomerang_2014_logo.svg/960px-Boomerang_2014_logo.svg.png",
  "stremtv-us:BounceXL.us": "https://i.imgur.com/GzxgSkc.png",
  "stremtv-us:BratTV.us": "https://i.imgur.com/Kkcp9Bk.png",
  "stremtv-us:Bravo.us": "https://i.imgur.com/JmTIRLF.png",
  "stremtv-us:BrevardGovernmentAccessTV.us": "https://i.imgur.com/eUTDIQ2.png",
  "stremtv-us:BritBoxMysteries.us": "https://i.imgur.com/PJdzoLN.png",
  "stremtv-us:BusinessRockstars.us": "https://i.imgur.com/vfAMWLJ.png",
  "stremtv-us:CANTV19.us": "https://i.imgur.com/PUQtIa3.png",
  "stremtv-us:CANTV21.us": "https://i.imgur.com/KP5bCYr.png",
  "stremtv-us:CANTV27.us": "https://i.imgur.com/43EpWsD.png",
  "stremtv-us:CANTV36.us": "https://i.imgur.com/43EpWsD.png",
  "stremtv-us:CBNEspanol.us": "https://i.imgur.com/G7B4wSM.png",
  "stremtv-us:CBS.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/CBS_logo_%282020%29.svg/960px-CBS_logo_%282020%29.svg.png",
  "stremtv-us:CBSNews247.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/CBS_News_247_logo.svg/960px-CBS_News_247_logo.svg.png",
  "stremtv-us:CBSNewsBaltimore.us": "https://i.imgur.com/jy3UfCe.png",
  "stremtv-us:CBSNewsBoston.us": "https://i.imgur.com/9un7R3N.png",
  "stremtv-us:CBSNewsChicago.us": "https://i.imgur.com/qGbVQir.png",
  "stremtv-us:CBSNewsColorado.us": "https://i.imgur.com/2oyYwBw.png",
  "stremtv-us:CBSNewsDetroit.us": "https://i.imgur.com/cMels2Y.png",
  "stremtv-us:CBSNewsLosAngeles.us": "https://i.imgur.com/klULxMV.png",
  "stremtv-us:CBSNewsMiami.us": "https://i.imgur.com/DExbVa9.png",
  "stremtv-us:CBSNewsMinnesota.us": "https://i.imgur.com/ubxwfMY.png",
  "stremtv-us:CBSNewsNewYork.us": "https://i.imgur.com/bpc4v0u.png",
  "stremtv-us:CBSNewsPhilly.us": "https://i.imgur.com/FmtTbNY.png",
  "stremtv-us:CBSNewsPittsburgh.us": "https://i.imgur.com/Un9IrUh.png",
  "stremtv-us:CBSNewsSacramento.us": "https://i.imgur.com/0e1kSGX.png",
  "stremtv-us:CBSSportsHQ.us": "https://i.imgur.com/q8BENJg.png",
  "stremtv-us:CFMTVChannel98.us": "https://i.imgur.com/LGs524I.png",
  "stremtv-us:CMAPChannel17.us": "https://i.imgur.com/wlYUEYc.png",
  "stremtv-us:CMAPChannel18.us": "https://i.imgur.com/wlYUEYc.png",
  "stremtv-us:CMAPChannel19.us": "https://i.imgur.com/wlYUEYc.png",
  "stremtv-us:CMAPChannel20.us": "https://i.imgur.com/wlYUEYc.png",
  "stremtv-us:CMCUSACountryMusicChannel.us": "https://i.imgur.com/QsANRSu.png",
  "stremtv-us:CMT.us": "https://i.imgur.com/S7DOpdY.png",
  "stremtv-us:CMTV.us": "https://i.imgur.com/73LKwAK.png",
  "stremtv-us:CNNOriginals.us": "https://provider-static.plex.tv/epg/cms/production/f351d697-1e1f-4e7d-86c7-5995698e593f/CNN_Originals_ChannelLogo_Dark_1500x1000_2025_-_Grace_Hartwig.png",
  "stremtv-us:CNNenEspanol.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Logo_de_CNN_en_Espa%C3%B1ol_%282010-2015%29.svg/960px-Logo_de_CNN_en_Espa%C3%B1ol_%282010-2015%29.svg.png",
  "stremtv-us:CSatTV.us": "https://i.imgur.com/fp2EaLJ.png",
  "stremtv-us:CTNCourtFeed.us": "https://i.imgur.com/pb0TFQt.jpeg",
  "stremtv-us:CTNLiveStream2.us": "https://i.imgur.com/pb0TFQt.jpeg",
  "stremtv-us:CTNTVConneticut.us": "https://i.imgur.com/pb0TFQt.jpg",
  "stremtv-us:CTV.us": "https://i.imgur.com/N5uiIJo.png",
  "stremtv-us:CVCEducation.us": "https://i.imgur.com/tUgEAUJ.png",
  "stremtv-us:CVCGovernment.us": "https://i.imgur.com/qLJhNhq.png",
  "stremtv-us:CVCPublic.us": "https://i.imgur.com/KiTtkBQ.png",
  "stremtv-us:CVTVChannel192.us": "https://i.imgur.com/loGNYCc.png",
  "stremtv-us:CVTVChannel194.us": "https://i.imgur.com/loGNYCc.png",
  "stremtv-us:CameraSmileTV.us": "https://i.imgur.com/V5h4R83.png",
  "stremtv-us:CanalInfantil.us": "https://i.imgur.com/WGk7MJ3.png",
  "stremtv-us:CanelaTV.us": "https://i.imgur.com/8Hllkpk.png",
  "stremtv-us:CarsTV.us": "https://i.imgur.com/JLSHiTp.png",
  "stremtv-us:CartoonNetwork.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Cartoon_Network_2010_logo.svg/960px-Cartoon_Network_2010_logo.svg.png",
  "stremtv-us:CartoonNetworkLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Cartoon_Network_2010_logo.svg/960px-Cartoon_Network_2010_logo.svg.png",
  "stremtv-us:CartoonitoLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Cartoonito_-_Logo_2021.svg/960px-Cartoonito_-_Logo_2021.svg.png",
  "stremtv-us:CatholicFaithNetwork.us": "https://upload.wikimedia.org/wikipedia/en/0/07/Catholic_Faith_Network_2018.png",
  "stremtv-us:CelebrityNameGame.us": "https://provider-static.plex.tv/epg/cms/production/773232e1-5c36-490b-922e-e5be8ec12eb2/celebrityd5796a3e14bf45513f7b3071b90d030.png",
  "stremtv-us:CelebritySceneTV.us": "https://i.imgur.com/n36jriB.png",
  "stremtv-us:CerritosTV3.us": "https://i.imgur.com/huCBOIy.png",
  "stremtv-us:CheddarNews.us": "https://i.imgur.com/tuP9GW8.png",
  "stremtv-us:ChefChampion.us": "https://i.imgur.com/15a9pG9.png",
  "stremtv-us:ChefRocShow.us": "https://i.imgur.com/vhVnAzE.png",
  "stremtv-us:Choppertown.us": "https://i.imgur.com/U6cu5Ms.png",
  "stremtv-us:ChristianYouthChannelCYC.us": "https://i.imgur.com/61eV77C.png",
  "stremtv-us:CinePremium.us": "https://i.imgur.com/tC3jGd4.png",
  "stremtv-us:CinePride.us": "https://i.imgur.com/Y4Wgq8I.png",
  "stremtv-us:CineSony.us": "https://i.imgur.com/bZWoDTg.png",
  "stremtv-us:Cinecanal.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/CinecanalLA.png/960px-CinecanalLA.png",
  "stremtv-us:Cinemax.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Cinemax_2016.svg/960px-Cinemax_2016.svg.png",
  "stremtv-us:CinemaxLatinAmerica.us": "https://i.imgur.com/cZWoJWD.png",
  "stremtv-us:Cinevault80s.us": "https://i.imgur.com/xaCyyDd.png",
  "stremtv-us:CinevaultWesterns.us": "https://i.imgur.com/K1W137J.png",
  "stremtv-us:Circle.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Circle_Network_logo.svg/960px-Circle_Network_logo.svg.png",
  "stremtv-us:CityTV20SantaMonica.us": "https://i.imgur.com/NY4fOLy.png",
  "stremtv-us:CityTVCarlsbad.us": "https://i.imgur.com/G6h8efT.png",
  "stremtv-us:CityTVLakewood.us": "https://i.imgur.com/e1shzv9.png",
  "stremtv-us:CityTVSanDiego.us": "https://i.imgur.com/OfNV6I7.png",
  "stremtv-us:CityofFortPierce.us": "https://i.imgur.com/2ChoSsi.png",
  "stremtv-us:CityofPompanoBeach.us": "https://i.imgur.com/Bv9OGrH.png",
  "stremtv-us:Clarity4K.us": "https://i.imgur.com/M87kbVk.png",
  "stremtv-us:ClassicCinema.us": "https://i.imgur.com/FJoPnTb.png",
  "stremtv-us:CloudflareTV.us": "https://i.imgur.com/l4m0is8.jpeg",
  "stremtv-us:ClubbingTV.us": "https://i.imgur.com/MyiA92q.png",
  "stremtv-us:ColdCaseFiles.us": "https://i.imgur.com/mowSfj6.png",
  "stremtv-us:ComedyCentralLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Comedy_Central_2018.svg/960px-Comedy_Central_2018.svg.png",
  "stremtv-us:ComedyDynamics.us": "https://i.imgur.com/1lEvUOa.png",
  "stremtv-us:ComedyTV.us": "https://i.imgur.com/KLfXnba.png",
  "stremtv-us:ConcertChannel.us": "https://i.imgur.com/u2irADf.png",
  "stremtv-us:CookingChannel.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/39/Cooking_Channel.svg/960px-Cooking_Channel.svg.png",
  "stremtv-us:CookingPanda.us": "https://i.imgur.com/bhY0Zcs.png",
  "stremtv-us:CruzTV.us": "https://i.imgur.com/qOO2SaH.png",
  "stremtv-us:CypressChannel36.us": "https://i.imgur.com/vOvoHBC.png",
  "stremtv-us:DCC.us": "https://i.imgur.com/YBWbiWZ.png",
  "stremtv-us:DCCouncilHearingRoom120.us": "https://i.imgur.com/8fljC7g.png",
  "stremtv-us:DHE.us": "https://i.imgur.com/nsttoEa.png",
  "stremtv-us:DKN.us": "https://i.imgur.com/DIau0GB.png",
  "stremtv-us:DUST.us": "https://i.imgur.com/FxYhME9.png",
  "stremtv-us:DangerTV.us": "https://i.imgur.com/4aTk45R.png",
  "stremtv-us:DarkMatterTV.us": "https://i.imgur.com/9K8T3ND.png",
  "stremtv-us:Dateline247.us": "https://i.imgur.com/8mAJuut.png",
  "stremtv-us:DePeliculaUS.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/DPel%C3%ADcula_2021.svg/960px-DPel%C3%ADcula_2021.svg.png",
  "stremtv-us:DeadlyWomen.us": "https://i.imgur.com/dDVZ5Vd.png",
  "stremtv-us:DealorNoDeal.us": "https://i.imgur.com/lZvNXA1.png",
  "stremtv-us:Denver8TV.us": "https://i.imgur.com/wMIy5jb.png",
  "stremtv-us:DerryTV17.us": "https://i.imgur.com/MRR6UL3.png",
  "stremtv-us:DerryTV23.us": "https://i.imgur.com/MRR6UL3.png",
  "stremtv-us:DesignatedSurvivor.us": "https://provider-static.plex.tv/epg/cms/production/6f31f52b-2b65-49eb-91e5-52e07edd1927/DesignatedSurvivor_Plex_1500x1000_Logo_Dark.png",
  "stremtv-us:DestinationAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/57/Destination_America_logo.svg/960px-Destination_America_logo.svg.png",
  "stremtv-us:DidgahTV.us": "https://i.imgur.com/3SeAyBS.png",
  "stremtv-us:DiscoveryChannel.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/2019_Discovery_logo.svg/960px-2019_Discovery_logo.svg.png",
  "stremtv-us:DiscoveryChannelLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/2019_Discovery_logo.svg/960px-2019_Discovery_logo.svg.png",
  "stremtv-us:DiscoveryScienceLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Discovery_science_new_logo_2017.png/960px-Discovery_science_new_logo_2017.png",
  "stremtv-us:DiscoveryTheaterLatinAmerica.us": "https://i.imgur.com/AqR0Jkn.png",
  "stremtv-us:DiscoveryTurbo.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Discovery_Turbo_2025.svg/1920px-Discovery_Turbo_2025.svg.png",
  "stremtv-us:DiscoveryTurboLatinAmerica.us": "https://i.imgur.com/1pQPxu3.png",
  "stremtv-us:DiscoveryWorld.us": "https://i.imgur.com/yNFmUkE.png",
  "stremtv-us:DisneyJunior.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/2024_Disney_Jr._Logo.svg/960px-2024_Disney_Jr._Logo.svg.png",
  "stremtv-us:DisneyXD.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/2015_Disney_XD_logo.svg/960px-2015_Disney_XD_logo.svg.png",
  "stremtv-us:DistrictofColumbiaNetwork.us": "https://i.imgur.com/GGZ8BQ8.png",
  "stremtv-us:DoctorWhoClassic.us": "https://i.imgur.com/JIqJQQM.png",
  "stremtv-us:DocumentaryPlus.us": "https://i.imgur.com/x57klfS.png",
  "stremtv-us:DogWhisperer.us": "https://i.imgur.com/tgWypVJ.png",
  "stremtv-us:DogtheBountyHunter.us": "https://i.imgur.com/lMICupK.png",
  "stremtv-us:DrGeneScott.us": "https://i.imgur.com/Db3EI19.png",
  "stremtv-us:DraftKingsNetwork.us": "https://i.imgur.com/SFYhgrt.png",
  "stremtv-us:DryBarComedyPlus.us": "https://i.imgur.com/3N2C60N.png",
  "stremtv-us:DuckDynasty.us": "https://i.imgur.com/vMcSlwm.png",
  "stremtv-us:DungeonTV.us": "https://i.imgur.com/cwazXHb.png",
  "stremtv-us:EBS.us": "https://i.imgur.com/zqbK2IB.png",
  "stremtv-us:EBSCinema.us": "https://i.imgur.com/fewPTFE.png",
  "stremtv-us:EBSMusika.us": "https://i.imgur.com/lSpplhD.png",
  "stremtv-us:ELatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/E%21_Logo_2012.svg/500px-E%21_Logo_2012.svg.png",
  "stremtv-us:ESPN.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/960px-ESPN_wordmark.svg.png",
  "stremtv-us:ESPN2.us": "https://i.imgur.com/00tsvjE.png",
  "stremtv-us:ESPN2LatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/ESPN2_logo.svg/960px-ESPN2_logo.svg.png",
  "stremtv-us:ESPN3LatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/ESPN3_Logo.png/960px-ESPN3_Logo.png",
  "stremtv-us:ESPN4LatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/ESPN_4_logo.svg/960px-ESPN_4_logo.svg.png",
  "stremtv-us:ESPN5LatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/960px-ESPN_wordmark.svg.png",
  "stremtv-us:ESPN7LatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/960px-ESPN_wordmark.svg.png",
  "stremtv-us:ESPNExtraLatinAmerica.us": "https://i.imgur.com/8P8N2Ov.png",
  "stremtv-us:ESPNLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/ESPN_wordmark.svg/960px-ESPN_wordmark.svg.png",
  "stremtv-us:ESPNU.us": "https://i.imgur.com/HiBrysh.png",
  "stremtv-us:EbonyTVbyLionsgate.us": "https://provider-static.plex.tv/epg/cms/production/234d5377-ab07-41bf-acd6-34c17c1c051a/EbonyTV_Plex_Logo_Light_1500x1000.png",
  "stremtv-us:ElSembradorNuevaEvangelizacionESNE.us": "https://i.imgur.com/APhSi1Y.jpg",
  "stremtv-us:ElbesharaGTV.us": "https://i.imgur.com/b0Wx7pE.png",
  "stremtv-us:ElectricNow.us": "https://provider-static.plex.tv/epg/cms/production/7685b801-1ef6-4098-947a-4ccada912e33/Electric_Now_Logo_For_Dark_Background_EN.png",
  "stremtv-us:ElevationChurchNetwork.us": "https://i.imgur.com/VosP75g.png",
  "stremtv-us:EntertainmentTonight.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Entertainment_Tonight_2021.svg/960px-Entertainment_Tonight_2021.svg.png",
  "stremtv-us:EntrepreneurTV.us": "https://i.imgur.com/isRfHYZ.png",
  "stremtv-us:EstrellaGames.us": "https://i.imgur.com/Z52nEnH.png",
  "stremtv-us:EstrellaNews.us": "https://i.imgur.com/HRrkhLq.png",
  "stremtv-us:ExtremaTV.us": "https://i.imgur.com/Z1QVkqu.png",
  "stremtv-us:FGTV.us": "https://i.imgur.com/RXFmzVY.png",
  "stremtv-us:FITE247.us": "https://i.imgur.com/ESV6qgH.png",
  "stremtv-us:FTFSports.us": "https://i.imgur.com/yvUjOI3.png",
  "stremtv-us:FXLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4d/FX_International_logo.svg/960px-FX_International_logo.svg.png",
  "stremtv-us:FailArmy.us": "https://i.imgur.com/VIpQJxL.png",
  "stremtv-us:FairgroundAICreatorTV.us": "https://raw.githubusercontent.com/RoqueDJ/iptv-svg/main/1792454211883.png",
  "stremtv-us:FaithTV.us": "https://i.imgur.com/lUBnKK1.png",
  "stremtv-us:FashionFinds.us": "https://i.imgur.com/GvDRZgq.png",
  "stremtv-us:FearFactor.us": "https://i.imgur.com/CIYnLWz.png",
  "stremtv-us:FernandinaBeachChannel.us": "https://i.imgur.com/9UfyekJ.png",
  "stremtv-us:FilAmTVNetwork.us": "https://i.imgur.com/nRiApdI.png",
  "stremtv-us:FilmRiseForensicFiles.us": "https://i.imgur.com/8j2npVc.png",
  "stremtv-us:FilmRiseWestern.us": "https://provider-static.plex.tv/epg/cms/production/924cac96-f0da-4eea-aab9-87c708a87f99/FilmRise_Western_1500x1000_Light_Logo.png",
  "stremtv-us:FlowersTVUSA.us": "https://upload.wikimedia.org/wikipedia/ml/1/1c/Flowers-Onam.png",
  "stremtv-us:FoodNetwork.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Food_Network_New_Logo.png/960px-Food_Network_New_Logo.png",
  "stremtv-us:FoodNetworkLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Food_Network_New_Logo.png/960px-Food_Network_New_Logo.png",
  "stremtv-us:FoxBusinessNetwork.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Fox_Business.svg/960px-Fox_Business.svg.png",
  "stremtv-us:FoxNewsChannel.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Fox_News_Channel_logo.svg/960px-Fox_News_Channel_logo.svg.png",
  "stremtv-us:FoxSoul.us": "https://i.imgur.com/YIamDGn.png",
  "stremtv-us:FoxSports1.us": "https://i.imgur.com/O9BapV9.png",
  "stremtv-us:FoxWeather.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Fox_Weather_logo.svg/960px-Fox_Weather_logo.svg.png",
  "stremtv-us:FreeSpeechTV.us": "https://i.imgur.com/Qq6heRq.png",
  "stremtv-us:FrightFlix.us": "https://i.imgur.com/rgNQYAl.png",
  "stremtv-us:Fuse.us": "https://upload.wikimedia.org/wikipedia/commons/c/c2/Fuse_Black_Logo_2017.png",
  "stremtv-us:GCNAmerica.us": "https://i.imgur.com/DWSWrtV.png",
  "stremtv-us:Gagsnetwork.us": "https://i.imgur.com/ENj5GIp.png",
  "stremtv-us:GalxyTV.us": "https://i.imgur.com/7gZlQDn.png",
  "stremtv-us:GameShowCentral.us": "https://i.imgur.com/Uuc5h1s.png",
  "stremtv-us:GameShowNetwork.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Game_Show_Network_2018.svg/960px-Game_Show_Network_2018.svg.png",
  "stremtv-us:GanjeHozourTV.us": "https://i.imgur.com/TnQYtKh.png",
  "stremtv-us:GemShoppingNetwork.us": "https://i.imgur.com/WlHEpAu.png",
  "stremtv-us:GenesisScienceNetwork.us": "https://i.imgur.com/CFAn996.png",
  "stremtv-us:Getfactual.us": "https://i.imgur.com/4oVcjLd.png",
  "stremtv-us:GhostHunters.us": "https://i.imgur.com/KdBr6rG.png",
  "stremtv-us:Glendale11AZ.us": "https://i.imgur.com/jehiyV7.png",
  "stremtv-us:GlobalFashionChannel.us": "https://i.imgur.com/s4eGYEP.jpg",
  "stremtv-us:GlobalWorldTV.us": "https://i.imgur.com/2u33Ayy.jpeg",
  "stremtv-us:GoTraveler.us": "https://i.imgur.com/IaRcN1G.png",
  "stremtv-us:GolfChannelLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Golf_Channel_Logo_2018.png/960px-Golf_Channel_Logo_2018.png",
  "stremtv-us:GoodLife45.us": "https://i.imgur.com/AQfVNMK.png",
  "stremtv-us:GordonRamsaysHellsKitchen.us": "https://i.imgur.com/WgN4T18.png",
  "stremtv-us:GospelTruthTV.us": "https://i.imgur.com/LI52X2q.png",
  "stremtv-us:GovernmentTV16.us": "https://i.imgur.com/iv9Vfcb.png",
  "stremtv-us:GravitasMovies.us": "https://i.imgur.com/H2hD4vT.png",
  "stremtv-us:GreaterLoveTV.us": "https://i.imgur.com/WE0cRXR.png",
  "stremtv-us:GritXtra.us": "https://provider-static.plex.tv/epg/cms/production/dbbb9bca-0b08-43b5-a0e7-715df9a6dbfd/_ChannelLogo_1500x1000.png",
  "stremtv-us:GuangdongTVAmerica.us": "https://i.imgur.com/7J4qGjA.png",
  "stremtv-us:GunAzTV.us": "https://i.imgur.com/2ZnQazl.png",
  "stremtv-us:HBO2LatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/HBO2_logo.svg/960px-HBO2_logo.svg.png",
  "stremtv-us:HBOFamilyLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/HBO_Family.svg/960px-HBO_Family.svg.png",
  "stremtv-us:HBOLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/HBO_logo.svg/960px-HBO_logo.svg.png",
  "stremtv-us:HBOPlusLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f9/Logohboplus2019.svg/960px-Logohboplus2019.svg.png",
  "stremtv-us:HGTVLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/HGTV_US_Logo_2015.svg/960px-HGTV_US_Logo_2015.svg.png",
  "stremtv-us:HMIPROMZNEWS.us": "https://i.imgur.com/gwPaw3v.png",
  "stremtv-us:HTV.us": "https://i.imgur.com/NlKFNHS.png",
  "stremtv-us:HTV1HoustonTelevision.us": "https://i.imgur.com/zvj1boM.jpg",
  "stremtv-us:HTV2HoustonTelevision.us": "https://i.imgur.com/zvj1boM.jpg",
  "stremtv-us:HallmarkMoviesMore.us": "https://provider-static.plex.tv/epg/cms/production/29af70d1-d3ba-4a16-bc4d-bd99e7e7def4/hallmark-movies-and-more_color.png",
  "stremtv-us:HappyKids.us": "https://i.imgur.com/cPrUCFw.png",
  "stremtv-us:HarmonyGospelMusicTV.us": "https://i.imgur.com/iDiGBE3.png",
  "stremtv-us:HasbroLegends.us": "https://i.imgur.com/JDM9rEV.png",
  "stremtv-us:HellsKitchen.us": "https://i.imgur.com/P9eT0O9.png",
  "stremtv-us:HiYAH.us": "https://i.imgur.com/sOYAnTB.png",
  "stremtv-us:HighVisionTV.us": "https://i.imgur.com/zhCgoru.png",
  "stremtv-us:HillsboroughTV.us": "https://i.imgur.com/fUne7FX.png",
  "stremtv-us:HisGloryTV.us": "https://i.imgur.com/VTcdAJj.jpeg",
  "stremtv-us:History.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/History_%282021%29.svg/500px-History_%282021%29.svg.png",
  "stremtv-us:History2LatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/History2_logo_%282022%29.svg/500px-History2_logo_%282022%29.svg.png",
  "stremtv-us:HistoryLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/History_%282021%29.svg/500px-History_%282021%29.svg.png",
  "stremtv-us:HmongStarTV.us": "https://i.imgur.com/dRsacao.png",
  "stremtv-us:HolaTVLatinAmerica.us": "https://i.imgur.com/i0Qexxd.png",
  "stremtv-us:HollyWire.us": "https://i.imgur.com/oVNjFoj.png",
  "stremtv-us:HomeMadeNation.us": "https://i.imgur.com/IdGNIoB.png",
  "stremtv-us:HomesUnderHammer.us": "https://i.imgur.com/P5Haaln.png",
  "stremtv-us:HopeChannelInterAmerica.us": "https://i.imgur.com/wzvgAch.png",
  "stremtv-us:HopeChannelInterAmericaEnglish.us": "https://i.imgur.com/wzvgAch.png",
  "stremtv-us:HopeChannelInternational.us": "https://i.imgur.com/PNihgl2.png",
  "stremtv-us:HopeChannelNorthAmerica.us": "https://i.imgur.com/2qXqajS.png",
  "stremtv-us:Hungry.us": "https://i.imgur.com/MIUDYh0.png",
  "stremtv-us:IFC.us": "https://i.imgur.com/bQdkyF9.png",
  "stremtv-us:INSP.us": "https://i.imgur.com/YgOC51j.png",
  "stremtv-us:IONPlus.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/ION_Plus_logo.svg/960px-ION_Plus_logo.svg.png",
  "stremtv-us:ImpactNetwork.us": "https://i.imgur.com/57NH9sS.png",
  "stremtv-us:ImpossibleQuizShow.us": "https://i.imgur.com/9EWffqx.png",
  "stremtv-us:InsideCrime.us": "https://i.imgur.com/wvQYWsj.png",
  "stremtv-us:IntheKitchen.us": "https://i.imgur.com/HrRUd6r.png",
  "stremtv-us:InvestigationDiscovery.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/InvestigationDiscoveryLogo2020.svg/960px-InvestigationDiscoveryLogo2020.svg.png",
  "stremtv-us:ItIsWrittenTV.us": "https://i.imgur.com/0jgzoSF.png",
  "stremtv-us:ItsSupernaturalNetwork.us": "https://i.imgur.com/JWrdL9a.png",
  "stremtv-us:JohnnyCarsonTV.us": "https://i.imgur.com/KBTqpJ7.png",
  "stremtv-us:Journy.us": "https://i.imgur.com/1JNrLxq.png",
  "stremtv-us:JudgeNosey.us": "https://i.imgur.com/S4r98AB.png",
  "stremtv-us:JustforLaughsGags.us": "https://i.imgur.com/HjVEVMJ.png",
  "stremtv-us:JusticeCentralTV.us": "https://i.imgur.com/peuHszg.png",
  "stremtv-us:KBSV231.us": "https://i.imgur.com/6lklsyN.png",
  "stremtv-us:KContentbyCJENM.us": "https://i.imgur.com/lRy231d.png",
  "stremtv-us:KIIOLD101.us": "https://i.imgur.com/wkzwXFO.png",
  "stremtv-us:KIIOLD104.us": "https://i.imgur.com/Spu4s89.png",
  "stremtv-us:KMCTTV391.us": "https://upload.wikimedia.org/wikipedia/en/d/d9/KMCT_Monroe%27s_Christian_Television_logo.png",
  "stremtv-us:KNOVCD411.us": "https://i.imgur.com/D7Lzqyl.png",
  "stremtv-us:KNXVTV611.us": "https://i.imgur.com/43s7KXt.png",
  "stremtv-us:KOCTChannel18.us": "https://i.imgur.com/6C71KwP.png",
  "stremtv-us:KOCTChannel19.us": "https://i.imgur.com/6C71KwP.png",
  "stremtv-us:KPVMLD251.us": "https://i.imgur.com/dGoQ88j.png",
  "stremtv-us:KRGVTV52.us": "https://i.imgur.com/kTh2jgF.png",
  "stremtv-us:KSCE381.us": "https://i.imgur.com/FioxUa3.png",
  "stremtv-us:KSCE383.us": "https://i.imgur.com/P0vZXU0.png",
  "stremtv-us:KVTNDT251.us": "https://i.imgur.com/CjKQuEP.png",
  "stremtv-us:KajouTV.us": "https://i.imgur.com/2XzghdT.png",
  "stremtv-us:KartoonChannel.us": "https://i.imgur.com/1luzP3T.png",
  "stremtv-us:KernCountyTV.us": "https://i.imgur.com/AJcuBCF.png",
  "stremtv-us:KidsFlix.us": "https://i.imgur.com/4Pn0ADQ.png",
  "stremtv-us:LGTV.us": "https://i.imgur.com/d5w2pT4.png",
  "stremtv-us:LIVExLIVE.us": "https://i.imgur.com/KFzEoed.png",
  "stremtv-us:LLBNHisLight.us": "https://i.imgur.com/YkLZjRw.png",
  "stremtv-us:LLBNHisWord.us": "https://i.imgur.com/GbyHlS2.png",
  "stremtv-us:LLBNTVArabic.us": "https://i.imgur.com/fbrQpC4.png",
  "stremtv-us:LLBNTVChinese.us": "https://i.imgur.com/C0jUDMn.png",
  "stremtv-us:LLBNTVKorean.us": "https://i.imgur.com/WsOfy19.png",
  "stremtv-us:LLBNTVLatino.us": "https://i.imgur.com/WsOfy19.png",
  "stremtv-us:LLBNTVRomanian.us": "https://i.imgur.com/WsOfy19.png",
  "stremtv-us:LLBNTVSouthAsia.us": "https://i.imgur.com/WsOfy19.png",
  "stremtv-us:LaoThaiTV.us": "https://i.imgur.com/q6cQzbv.png",
  "stremtv-us:LasVegasTonightwithDaleDavidson.us": "https://i.imgur.com/05Xdqa6.png",
  "stremtv-us:LatinoChannelTV.us": "https://i.imgur.com/FcLIOGp.png",
  "stremtv-us:LegoChannel.us": "https://i.imgur.com/xePwW13.png",
  "stremtv-us:LeominsterTVEducational.us": "https://i.imgur.com/Cy94oLl.png",
  "stremtv-us:LeominsterTVGovernment.us": "https://i.imgur.com/aHkRDQw.png",
  "stremtv-us:LeominsterTVPublic.us": "https://i.imgur.com/lTzoshf.png",
  "stremtv-us:LexTV.us": "https://i.imgur.com/a36SPo6.png",
  "stremtv-us:LifetimeLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Logo_Lifetime_2020.svg/960px-Logo_Lifetime_2020.svg.png",
  "stremtv-us:LittleGuyanaTV.us": "https://i.imgur.com/b475xOT.jpg",
  "stremtv-us:LiveNOWfromFOX.us": "https://i.imgur.com/1JnyzHv.png",
  "stremtv-us:LogosTV.us": "https://i.imgur.com/h8DioXU.png",
  "stremtv-us:LogosTVEnglish.us": "https://i.imgur.com/LDfEK81.png",
  "stremtv-us:LoveNatureenEspanol.us": "https://i.imgur.com/7uNdcWB.png",
  "stremtv-us:LuckyDog.us": "https://i.imgur.com/1j4gwL3.png",
  "stremtv-us:MBC1USA.us": "https://i.imgur.com/CiA3plN.png",
  "stremtv-us:MBC3USA.us": "https://i.imgur.com/PVt8OPN.png",
  "stremtv-us:MBCAmerica.us": "https://i.imgur.com/RRc23ra.png",
  "stremtv-us:MBCDramaUSA.us": "https://i.imgur.com/g5PWnqp.png",
  "stremtv-us:MBCMasrUSA.us": "https://i.imgur.com/o2elx0u.png",
  "stremtv-us:MBTV.us": "https://i.imgur.com/LyqFr9E.png",
  "stremtv-us:MCN6ArtsChannel.us": "https://i.imgur.com/j6IiysJ.png",
  "stremtv-us:MCN6MainChannel.us": "https://i.imgur.com/j6IiysJ.png",
  "stremtv-us:MCN6MusicChannel.us": "https://i.imgur.com/j6IiysJ.png",
  "stremtv-us:MCPSSTV.us": "https://i.imgur.com/qo5sk1g.png",
  "stremtv-us:MLB.us": "https://i.imgur.com/ym3su2J.png",
  "stremtv-us:MLBStrikeZone.us": "https://i.imgur.com/uMI1ySO.png",
  "stremtv-us:MRVTVChannel44.us": "https://i.imgur.com/QZcENP2.png",
  "stremtv-us:MRVTVChannel45.us": "https://i.imgur.com/QZcENP2.png",
  "stremtv-us:MSNOW.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/MS_NOW_logo.svg/960px-MS_NOW_logo.svg.png",
  "stremtv-us:MST3K.us": "https://i.imgur.com/2LSdcga.png",
  "stremtv-us:MTC.us": "https://i.imgur.com/JxoAR4j.png",
  "stremtv-us:MTV.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/MTV_2021_%28brand_version%29.svg/960px-MTV_2021_%28brand_version%29.svg.png",
  "stremtv-us:MTV2.us": "https://upload.wikimedia.org/wikipedia/en/thumb/2/21/MTV2_logo_2013.svg/960px-MTV2_logo_2013.svg.png",
  "stremtv-us:MTVLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/MTV_2021_%28brand_version%29.svg/960px-MTV_2021_%28brand_version%29.svg.png",
  "stremtv-us:MTVLive.us": "https://i.imgur.com/3UByLqb.png",
  "stremtv-us:MadDogandMerrill.us": "https://i.imgur.com/5QQy3aW.png",
  "stremtv-us:MadeInHollywood.us": "https://i.imgur.com/p16HNIM.png",
  "stremtv-us:MagellanTVNow.us": "https://i.imgur.com/gEraSp5.png",
  "stremtv-us:MajestadTV.us": "https://i.imgur.com/BJhrvtL.png",
  "stremtv-us:MariaVisionUSA.us": "https://i.imgur.com/eaVt8R1.png",
  "stremtv-us:MartinCountyTV.us": "https://i.imgur.com/7VzlbLp.png",
  "stremtv-us:McLeodsDaughters.us": "https://i.imgur.com/q4BBDzw.png",
  "stremtv-us:MidnightPulp.us": "https://provider-static.plex.tv/a/epg/channels/logos/gracenote/a1a2cdc3d6f0714c586e9959732580c7.png",
  "stremtv-us:MidpenMediaCenterChannel26.us": "https://i.imgur.com/aX1GkCD.png",
  "stremtv-us:MidpenMediaCenterChannel28.us": "https://i.imgur.com/RPJiolQ.png",
  "stremtv-us:MidpenMediaCenterChannel29.us": "https://i.imgur.com/RPJiolQ.png",
  "stremtv-us:MidpenMediaCenterChannel30.us": "https://i.imgur.com/RPJiolQ.png",
  "stremtv-us:MidpenMediaCenterChannel75.us": "https://i.imgur.com/RPJiolQ.png",
  "stremtv-us:MidsomerMurders.us": "https://i.imgur.com/VFqfyfY.png",
  "stremtv-us:MissionTV.us": "https://i.imgur.com/Hb38BNo.png",
  "stremtv-us:MohabatTV.us": "https://i.imgur.com/tucTC1O.jpg",
  "stremtv-us:MonroeCountyTV.us": "https://i.imgur.com/YJfzdSu.png",
  "stremtv-us:MovieSphereGold.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/MovieSphere_Gold_2025_logo.svg/500px-MovieSphere_Gold_2025_logo.svg.png",
  "stremtv-us:MyDestinationTV.us": "https://i.imgur.com/VJndl0m.png",
  "stremtv-us:MyTimeMovieNetworkEast.us": "https://i.imgur.com/HYgxPVQ.png",
  "stremtv-us:MysteryScienceTheater3000.us": "https://i.imgur.com/8KWjY4o.png",
  "stremtv-us:MysteryTV.us": "https://i.imgur.com/K4gwstM.png",
  "stremtv-us:Mythbusters.us": "https://i.imgur.com/wzzjvcH.png",
  "stremtv-us:NATTV.us": "https://i.imgur.com/a7tNaD5.png",
  "stremtv-us:NBATV.us": "https://upload.wikimedia.org/wikipedia/en/thumb/d/d2/NBA_TV.svg/960px-NBA_TV.svg.png",
  "stremtv-us:NBCComedyVault.us": "https://i.imgur.com/nydZWwg.png",
  "stremtv-us:NBCLX.us": "https://i.imgur.com/5iT7hEa.png",
  "stremtv-us:NBCSportsNOW.us": "https://i.imgur.com/EzNf2Yx.png",
  "stremtv-us:NCTV79.us": "https://i.imgur.com/64sZVF9.jpg",
  "stremtv-us:NEWKMOVIES.us": "https://i.imgur.com/wCgirjc.png",
  "stremtv-us:NEWKPOP.us": "https://i.imgur.com/B7ILXMc.png",
  "stremtv-us:NFLChannel.us": "https://i.imgur.com/mPGtwAP.png",
  "stremtv-us:NFLNetwork.us": "https://upload.wikimedia.org/wikipedia/en/thumb/8/8f/NFL_Network_logo.svg/960px-NFL_Network_logo.svg.png",
  "stremtv-us:NHLNetwork.us": "https://i.imgur.com/UNZ8bef.png",
  "stremtv-us:NHRATV.us": "https://i.imgur.com/jZgcm4k.png",
  "stremtv-us:NMBTV.us": "https://i.imgur.com/HTNoNnh.png",
  "stremtv-us:NOST.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/NOST-1080x1080.jpg/250px-NOST-1080x1080.jpg",
  "stremtv-us:NTDTVAsiaPacific.us": "https://i.imgur.com/iyFXcDy.png",
  "stremtv-us:NTDTVCanada.us": "https://i.imgur.com/iyFXcDy.png",
  "stremtv-us:NTDTVChina.us": "https://i.imgur.com/OpWTWdh.png",
  "stremtv-us:NTDTVEnglish.us": "https://i.imgur.com/26uv1ww.png",
  "stremtv-us:Naruto.us": "https://i.imgur.com/M8X3Kvc.png",
  "stremtv-us:NashuaETV.us": "https://i.imgur.com/iv9Vfcb.png",
  "stremtv-us:NatickEducationChannel.us": "https://i.imgur.com/VKU9qwy.png",
  "stremtv-us:NatickGovernmentChannel.us": "https://i.imgur.com/eA2WSXa.png",
  "stremtv-us:NatickPublicAccessChannel.us": "https://i.imgur.com/G4a3gW0.png",
  "stremtv-us:NationalGeographic.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Natgeologo.svg/960px-Natgeologo.svg.png",
  "stremtv-us:NationalGeographicLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Natgeologo.svg/960px-Natgeologo.svg.png",
  "stremtv-us:NationalGeographicWild.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/27/National_Geographic_Wild_logo.svg/960px-National_Geographic_Wild_logo.svg.png",
  "stremtv-us:News12Bronx.us": "https://i.imgur.com/d6xQiaf.png",
  "stremtv-us:News12Brooklyn.us": "https://i.imgur.com/fvcOzzK.png",
  "stremtv-us:News12HudsonValley.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/News_12_logo_2019.png/960px-News_12_logo_2019.png",
  "stremtv-us:News12LongIsland.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/News_12_logo_2019.png/960px-News_12_logo_2019.png",
  "stremtv-us:NewsmaxSpanish.us": "https://i.imgur.com/mrXMW7H.png",
  "stremtv-us:NewsmaxTV.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Newsmax_logo.svg/960px-Newsmax_logo.svg.png",
  "stremtv-us:NewsoftheWorld.us": "https://i.imgur.com/MfyRQCs.png",
  "stremtv-us:Newsy.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Newsy_2021.svg/960px-Newsy_2021.svg.png",
  "stremtv-us:NickJr.us": "https://i.imgur.com/KT4tdQs.png",
  "stremtv-us:NickJrLatinAmerica.us": "https://i.imgur.com/KT4tdQs.png",
  "stremtv-us:Nickelodeon.us": "https://i.imgur.com/E84jnP8.png",
  "stremtv-us:NickelodeonLatinAmerica.us": "https://i.imgur.com/E84jnP8.png",
  "stremtv-us:NinjaKidzTV.us": "https://i.imgur.com/7EngqUi.png",
  "stremtv-us:NorCastWeather.us": "https://i.imgur.com/AfjoZgo.png",
  "stremtv-us:Novelisima.us": "https://i.imgur.com/8dUS3Ih.png",
  "stremtv-us:NowMediaTelevision.us": "https://i.imgur.com/8m8gy0n.png",
  "stremtv-us:OCNTV.us": "https://i.imgur.com/iSB5Obl.png",
  "stremtv-us:OWN.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/19/OWN_2011_logo.svg/960px-OWN_2011_logo.svg.png",
  "stremtv-us:Olelo49.us": "https://i.imgur.com/4C5Xp8M.png",
  "stremtv-us:Olelo53.us": "https://i.imgur.com/xDuUrj9.png",
  "stremtv-us:Olelo54.us": "https://i.imgur.com/8BG31QL.png",
  "stremtv-us:Olelo55.us": "https://i.imgur.com/0qe2R8b.png",
  "stremtv-us:OmideIranTV.us": "https://i.imgur.com/CeMf68L.png",
  "stremtv-us:OneAmericaNewsNetwork.us": "https://upload.wikimedia.org/wikipedia/en/thumb/8/84/One_America_News_Network_logo.svg/960px-One_America_News_Network_logo.svg.png",
  "stremtv-us:OntarioPublicAccessChannel.us": "https://i.imgur.com/jg0cFDd.png",
  "stremtv-us:OrangeGovernmentAccessTV.us": "https://i.imgur.com/hyPTfxA.png",
  "stremtv-us:OutdoorAmerica.us": "https://i.imgur.com/UKfimFD.png",
  "stremtv-us:OutdoorChannel.us": "https://i.imgur.com/Kh4MWaY.png",
  "stremtv-us:OuterSphere.us": "https://provider-static.plex.tv/epg/cms/production/f162df8b-6532-43fe-9202-83a658090651/OuterSphere_1500x1000_Logo_Dark_-_Chris_Connors__1_.png",
  "stremtv-us:Overtime.us": "https://i.imgur.com/9S9k4IK.png",
  "stremtv-us:PBCTVChannel20.us": "https://i.imgur.com/2bGBbOZ.png",
  "stremtv-us:PBCTapeshTV.us": "https://i.imgur.com/50JzsmH.png",
  "stremtv-us:PBSAntiquesRoadshow.us": "https://i.imgur.com/U9CYaok.png",
  "stremtv-us:PBSKidsAlaska.us": "https://i.imgur.com/ambc9le.png",
  "stremtv-us:PBSKidsHawaii.us": "https://i.imgur.com/ambc9le.png",
  "stremtv-us:PBSNature.us": "https://i.imgur.com/Brry7cZ.png",
  "stremtv-us:PBSTravel.us": "https://i.imgur.com/A6GXhta.png",
  "stremtv-us:PCTChannel26.us": "https://i.imgur.com/xJSya25.png",
  "stremtv-us:PCTChannel27.us": "https://i.imgur.com/b0ufMkd.png",
  "stremtv-us:PCTV26.us": "https://i.imgur.com/3tMAQU7.png",
  "stremtv-us:PCTV28.us": "https://i.imgur.com/WahZg3L.png",
  "stremtv-us:PGATour.us": "https://i.imgur.com/J0TY9dG.png",
  "stremtv-us:PHLgovTV.us": "https://i.imgur.com/BmNc3hu.png",
  "stremtv-us:PHXTV.us": "https://i.imgur.com/RkTKR6x.png",
  "stremtv-us:PSLTV.us": "https://i.imgur.com/kzdRmTN.png",
  "stremtv-us:Pac12Insider.us": "https://i.imgur.com/736QREy.png",
  "stremtv-us:PacificIslandNetwork.us": "https://i.imgur.com/OtT1qYE.png",
  "stremtv-us:PalmBeachesTV.us": "https://i.imgur.com/kBol4Pf.png",
  "stremtv-us:ParamountNetwork.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Paramount_Network.svg/960px-Paramount_Network.svg.png",
  "stremtv-us:ParsTV.us": "https://i.imgur.com/RQ5DzEE.png",
  "stremtv-us:PascoTV.us": "https://i.imgur.com/CM91sME.png",
  "stremtv-us:PasionesLatinAmerica.us": "https://i.imgur.com/VGnbWjO.png",
  "stremtv-us:PayamJavanTV.us": "https://i.imgur.com/GYfsHh9.png",
  "stremtv-us:PayameAfghanTV.us": "https://i.imgur.com/t9wYYY9.png",
  "stremtv-us:PayameArameshTV.us": "https://i.imgur.com/WaPr0t0.png",
  "stremtv-us:PayvandTV.us": "https://i.imgur.com/A4gqEmG.png",
  "stremtv-us:PeopleAreAwesome.us": "https://i.imgur.com/MsIx7Ax.png",
  "stremtv-us:PetsTV.us": "https://i.imgur.com/qPqQmYo.png",
  "stremtv-us:PhillyCAM.us": "https://i.imgur.com/ENOr31n.png",
  "stremtv-us:PixLTV.us": "https://i.imgur.com/ysRh3Nl.png",
  "stremtv-us:PoconoTelevisionNetwork.us": "https://i.imgur.com/et6giFo.png",
  "stremtv-us:Portlandia.us": "https://i.imgur.com/I4KDvu9.png",
  "stremtv-us:PottaDivineTVUSA.us": "https://i.imgur.com/Yx0AnLW.png",
  "stremtv-us:PowerNationTV.us": "https://i.imgur.com/jguTO8E.png",
  "stremtv-us:PursuitChannel.us": "https://upload.wikimedia.org/wikipedia/en/d/d6/Pursuit_Channel_logo.png",
  "stremtv-us:PursuitUP.us": "https://i.imgur.com/5Vzwqts.png",
  "stremtv-us:QVC3.us": "https://i.imgur.com/edswdOO.png",
  "stremtv-us:RCTV.us": "https://i.imgur.com/DWwequ0.png",
  "stremtv-us:RCTV3.us": "https://i.imgur.com/TvFKG35.png",
  "stremtv-us:REVNAction.us": "https://i.imgur.com/xsm8mMd.png",
  "stremtv-us:RJTV.us": "https://i.imgur.com/a1zuW2C.png",
  "stremtv-us:RTHTV1.us": "https://i.imgur.com/4z0FiEA.png",
  "stremtv-us:RTHTV2Gospel.us": "https://i.imgur.com/4z0FiEA.png",
  "stremtv-us:RTN.us": "https://i.imgur.com/jjUzuLV.png",
  "stremtv-us:RVTV.us": "https://i.imgur.com/pBBb0wx.png",
  "stremtv-us:RVTVCivic.us": "https://i.imgur.com/cTLhQjo.png",
  "stremtv-us:RVTVGrantsPass.us": "https://i.imgur.com/Vpv0P6t.png",
  "stremtv-us:RVTVPrime.us": "https://i.imgur.com/0Qd9Ic7.png",
  "stremtv-us:RVTVVoices.us": "https://i.imgur.com/kOGQBZj.png",
  "stremtv-us:RacerNetwork.us": "https://upload.wikimedia.org/wikipedia/en/7/74/Racer_Network.jpg",
  "stremtv-us:RacerSelect.us": "https://i.imgur.com/CurtYvn.png",
  "stremtv-us:RadioMensajeTV.us": "https://i.imgur.com/TJNXjS2.png",
  "stremtv-us:RadioTelePuissance.us": "https://i.imgur.com/ZLPwJug.png",
  "stremtv-us:RadioTeleSentinel.us": "https://i.imgur.com/hy3BJxj.png",
  "stremtv-us:RadioyTelevisionMarti.us": "https://i.imgur.com/J2ZMa4g.png",
  "stremtv-us:RainbowRuby.us": "https://i.imgur.com/eHNU2OQ.png",
  "stremtv-us:RecipeTV.us": "https://i.imgur.com/HcL4a8z.png",
  "stremtv-us:RedApple21.us": "https://i.imgur.com/ICcQUCH.png",
  "stremtv-us:RetroCrush.us": "https://i.imgur.com/M40b4YI.png",
  "stremtv-us:RetroTV.us": "https://i.imgur.com/ofairB5.png",
  "stremtv-us:ReutersTV.us": "https://i.imgur.com/6eQ2nCJ.png",
  "stremtv-us:Revolt.us": "https://i.imgur.com/eaYnGpH.png",
  "stremtv-us:RiffTrax.us": "https://i.imgur.com/hM4yKMn.png",
  "stremtv-us:RuntimeEspanol.us": "https://i.imgur.com/OMQq19N.png",
  "stremtv-us:RyanandFriends.us": "https://i.imgur.com/jcIprmt.png",
  "stremtv-us:SBNTVGlobal.us": "https://i.imgur.com/NJu6oYB.png",
  "stremtv-us:SBNTVInternational.us": "https://i.imgur.com/NJu6oYB.png",
  "stremtv-us:SCCurrents.us": "https://i.imgur.com/8FZsNyK.png",
  "stremtv-us:SECNetwork.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/SEC_Network_logo.svg/960px-SEC_Network_logo.svg.png",
  "stremtv-us:SFGovTV.us": "https://i.imgur.com/uYXuwmV.png",
  "stremtv-us:SFGovTV2.us": "https://i.imgur.com/SOk5m5B.png",
  "stremtv-us:SGTN49.us": "https://i.imgur.com/4fbJRWW.png",
  "stremtv-us:SLOCountyChannel21.us": "https://i.imgur.com/CyQ472C.png",
  "stremtv-us:SMCTVChannel23.us": "https://i.imgur.com/J2SKPoY.png",
  "stremtv-us:SMCTVChannel24.us": "https://i.imgur.com/4Autljp.png",
  "stremtv-us:SMCTVChannel25.us": "https://i.imgur.com/5jBOsTc.png",
  "stremtv-us:SNLVault.us": "https://provider-static.plex.tv/epg/cms/production/712dae9e-9111-4bbc-8ea4-242e891ab5b3/snl-vault-fclogo-72-dpi-1500-x-1000-3-2-channel-logo-dark-plex-1.png",
  "stremtv-us:SPTV.us": "https://i.imgur.com/fl8I3cg.png",
  "stremtv-us:SUMtvEnglish.us": "https://i.imgur.com/hp1rJjX.png",
  "stremtv-us:SUMtvLatino.us": "https://i.imgur.com/ZObFN8Z.png",
  "stremtv-us:SYFY.us": "https://i.imgur.com/4fMWhUE.png",
  "stremtv-us:SalemNewsChannel.us": "https://i.imgur.com/aDbc64y.png",
  "stremtv-us:SamsungWildlife.us": "https://i.imgur.com/x06npU2.png",
  "stremtv-us:ScottsdaleChannel11.us": "https://i.imgur.com/lfE6Q9i.png",
  "stremtv-us:ScreenDreams.us": "https://i.imgur.com/AHIo9oz.png",
  "stremtv-us:ScrippsNews.us": "https://i.imgur.com/W0Jvi5o.png",
  "stremtv-us:SemillitasTV.us": "https://i.imgur.com/u3yujUd.png",
  "stremtv-us:Shabakeh7.us": "https://i.imgur.com/oHmh5Jb.png",
  "stremtv-us:ShalomWorld.us": "https://i.imgur.com/wnNd3b8.png",
  "stremtv-us:ShalomWorldPrayer.us": "https://i.imgur.com/uUrTto3.png",
  "stremtv-us:ShoutFactoryTV.us": "https://i.imgur.com/AgoGr6y.png",
  "stremtv-us:SkwadPlay.us": "https://i.imgur.com/cP56PrG.png",
  "stremtv-us:SmartLifeStyleTV.us": "https://i.imgur.com/kHFlTEy.png",
  "stremtv-us:SoReal.us": "https://i.imgur.com/wZ2uj9d.png",
  "stremtv-us:SonicTV.us": "https://i.imgur.com/TKhRlrR.png",
  "stremtv-us:SonyChannelAndes.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Sony_Channel_Logo.png/960px-Sony_Channel_Logo.png",
  "stremtv-us:SonyKALHindi.us": "https://i.imgur.com/9Qq8DKh.png",
  "stremtv-us:SonyMoviesLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Sony_Movies_Logo.svg/500px-Sony_Movies_Logo.svg.png",
  "stremtv-us:SoundViewCommunityMedia.us": "https://i.imgur.com/3gASzGc.png",
  "stremtv-us:SpiritTV.us": "https://i.imgur.com/yCp6vXz.png",
  "stremtv-us:SportsGrid.us": "https://i.imgur.com/ulGKX30.png",
  "stremtv-us:Stadium.us": "https://i.imgur.com/SnZOiER.png",
  "stremtv-us:StarChannelLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Star_Channel_2020.svg/960px-Star_Channel_2020.svg.png",
  "stremtv-us:StarzKidsFamily.us": "https://i.imgur.com/eE9FzEP.png",
  "stremtv-us:StoriesbyAMC.us": "https://i.imgur.com/QJtwJoS.png",
  "stremtv-us:Strongman.us": "https://i.imgur.com/bVQBF6R.png",
  "stremtv-us:StrykTV.us": "https://i.imgur.com/rKkHhkX.png",
  "stremtv-us:StudioUniversalLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/StudioUniversal2016.png/960px-StudioUniversal2016.png",
  "stremtv-us:SuperSimpleSongs.us": "https://i.imgur.com/3k4F7O9.png",
  "stremtv-us:Survivor.us": "https://i.imgur.com/Zz9SgY8.png",
  "stremtv-us:SwerveCombat.us": "https://i.imgur.com/eFZh7aG.png",
  "stremtv-us:SwerveSports.us": "https://i.imgur.com/GT0Yi2T.png",
  "stremtv-us:TAPTVChannel23.us": "https://i.imgur.com/5mhYHtD.png",
  "stremtv-us:TAPTVChannel24.us": "https://i.imgur.com/5mhYHtD.png",
  "stremtv-us:TAPTVChannel25.us": "https://i.imgur.com/5mhYHtD.png",
  "stremtv-us:TBN.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/TBN_logo_2015.jpg/960px-TBN_logo_2015.jpg",
  "stremtv-us:TBNArmenia.us": "https://i.imgur.com/U5XsT3j.png",
  "stremtv-us:TBNPacific.us": "https://i.imgur.com/yWJTxKk.png",
  "stremtv-us:TBNUkraine.us": "https://i.imgur.com/PhbrGyM.png",
  "stremtv-us:TCM.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/TCM_2021.svg/960px-TCM_2021.svg.png",
  "stremtv-us:TCMLatinAmerica.us": "https://i.imgur.com/QpDkrmT.png",
  "stremtv-us:TED.us": "https://i.imgur.com/KeIhwNP.png",
  "stremtv-us:TGJunior.us": "https://i.imgur.com/aqane40.png",
  "stremtv-us:TLCLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/TLC_Logo.svg/960px-TLC_Logo.svg.png",
  "stremtv-us:TMZ.us": "https://i.imgur.com/eLIe7Va.png",
  "stremtv-us:TNT.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/TNT_Logo_2016.svg/960px-TNT_Logo_2016.svg.png",
  "stremtv-us:TNTLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/TNT_Logo_2016.svg/960px-TNT_Logo_2016.svg.png",
  "stremtv-us:TNTNovelas.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/TNT_Novelas_2025.svg/1920px-TNT_Novelas_2025.svg.png",
  "stremtv-us:TNTSeriesLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/TNT_Series_2025.svg/1920px-TNT_Series_2025.svg.png",
  "stremtv-us:TODAYAllDay.us": "https://i.imgur.com/LhbQ8Mr.png",
  "stremtv-us:TUDN.us": "https://i.imgur.com/oT5CAvd.png",
  "stremtv-us:TUTV.us": "https://i.imgur.com/At0BPeA.png",
  "stremtv-us:TV4.us": "https://i.imgur.com/CRvQ6sF.png",
  "stremtv-us:TVQuisqueya.us": "https://i.imgur.com/G7X4LQI.png",
  "stremtv-us:TVSAGovernmentChannel.us": "https://i.imgur.com/3Om5TUc.png",
  "stremtv-us:TVSAPublicChannel.us": "https://i.imgur.com/3Om5TUc.png",
  "stremtv-us:TVSBoxing.us": "https://i.imgur.com/30ZoF75.png",
  "stremtv-us:TVSCipherNetwork.us": "https://i.imgur.com/yyz1S2W.png",
  "stremtv-us:TVSClassicMovies.us": "https://i.imgur.com/st1xMsw.png",
  "stremtv-us:TVSClassicSports.us": "https://i.imgur.com/auR0Mi6.png",
  "stremtv-us:TVSComedyNetwork.us": "https://i.imgur.com/rXORbti.png",
  "stremtv-us:TVSDriveInMovie.us": "https://i.imgur.com/OR9APjb.png",
  "stremtv-us:TVSFamilyChannel.us": "https://i.imgur.com/Y3EV3DL.png",
  "stremtv-us:TVSFilmNoirNetwork.us": "https://i.imgur.com/A4yWhQw.png",
  "stremtv-us:TVSHiTops.us": "https://i.imgur.com/RiWg1IA.png",
  "stremtv-us:TVSHollywoodHistory.us": "https://i.imgur.com/QtQGyMS.png",
  "stremtv-us:TVSMainstreet.us": "https://i.imgur.com/N9nQpnP.png",
  "stremtv-us:TVSNostalgia.us": "https://i.imgur.com/q72FCCQ.png",
  "stremtv-us:TVSNostalgiaMovies.us": "https://i.imgur.com/w4fxiKi.png",
  "stremtv-us:TVSPetParadeNetwork.us": "https://i.imgur.com/oGE1MOP.png",
  "stremtv-us:TVSPinballNetwork.us": "https://i.imgur.com/HHmc14i.png",
  "stremtv-us:TVSQuizShowNetwork.us": "https://i.imgur.com/5ljQwx2.png",
  "stremtv-us:TVSSports.us": "https://i.imgur.com/Lwwq62E.png",
  "stremtv-us:TVSTalkNetwork.us": "https://i.imgur.com/WsaVAhx.png",
  "stremtv-us:TVSTallyHo.us": "https://i.imgur.com/JlFwnDD.png",
  "stremtv-us:TVSTavern.us": "https://i.imgur.com/3GTIs4j.png",
  "stremtv-us:TVSTravelNetwork.us": "https://i.imgur.com/vSFf5Ce.png",
  "stremtv-us:TVSTurbo.us": "https://i.imgur.com/7zYIbU1.png",
  "stremtv-us:TVSWesternMovie.us": "https://i.imgur.com/dwr98qb.png",
  "stremtv-us:TVSWomenSports.us": "https://i.imgur.com/8hC4PfF.png",
  "stremtv-us:Tastemade.us": "https://i.imgur.com/xP7Ehn8.png",
  "stremtv-us:TastemadeTravel.us": "https://i.imgur.com/8s6aRwv.png",
  "stremtv-us:TastemadeenEspanol.us": "https://i.imgur.com/8s6aRwv.png",
  "stremtv-us:TeleBoston.us": "https://i.imgur.com/xeTtup8.png",
  "stremtv-us:TelemundoCorpusChristi.us": "https://upload.wikimedia.org/wikipedia/commons/9/98/Telemundo_Corpus_Christi_logo.png",
  "stremtv-us:TelemundoInternacional.us": "https://i.imgur.com/j2O4ndp.png",
  "stremtv-us:Tempe11.us": "https://i.imgur.com/KMeHRV3.png",
  "stremtv-us:TennisChannel.us": "https://i.imgur.com/tsljAnY.png",
  "stremtv-us:TeveVidaNetwork.us": "https://i.imgur.com/lCpf5P1.png",
  "stremtv-us:TheAsylum.us": "https://i.imgur.com/dx9tt1B.png",
  "stremtv-us:TheBobRossChannel.us": "https://i.imgur.com/gFHKCbZ.png",
  "stremtv-us:TheCarolBurnettShow.us": "https://i.imgur.com/1a03FlX.png",
  "stremtv-us:TheCityofMarina.us": "https://i.imgur.com/ldyanxN.png",
  "stremtv-us:TheConners.us": "https://provider-static.plex.tv/epg/cms/production/3acd803e-a5e3-430c-a34e-508123d2bd95/TheConners_1500x1000_Logo_Dark.png",
  "stremtv-us:TheCountryNetwork.us": "https://upload.wikimedia.org/wikipedia/en/d/dd/The_Country_Network_Logo.png",
  "stremtv-us:TheDesignNetwork.us": "https://i.imgur.com/J5YJ3r3.png",
  "stremtv-us:TheFirstTV.us": "https://i.imgur.com/rOSlp93.png",
  "stremtv-us:TheHillTV.us": "https://i.imgur.com/Ioh5xbx.png",
  "stremtv-us:TheJamieOliverChannel.us": "https://i.imgur.com/4v93XUB.png",
  "stremtv-us:TheLoop.us": "https://i.imgur.com/iyYLuJj.png",
  "stremtv-us:TheMontereyChannel.us": "https://i.imgur.com/400m3ow.png",
  "stremtv-us:TheNowNetwork.us": "https://i.imgur.com/Wp6d0F8.png",
  "stremtv-us:ThePeninsulaChannel.us": "https://i.imgur.com/Ybp6YKD.png",
  "stremtv-us:ThePetCollective.us": "https://i.imgur.com/yH7n2dF.png",
  "stremtv-us:ThePointTelevsionNetwork.us": "https://i.imgur.com/2LWc0OG.png",
  "stremtv-us:ThePriceIsRightTheBarkerEra.us": "https://i.imgur.com/LuE8Wl4.png",
  "stremtv-us:TheWalkingDeadUniverse.us": "https://i.imgur.com/IwJ5Pnc.png",
  "stremtv-us:TheWordNetwork.us": "https://i.imgur.com/ltFBrrj.png",
  "stremtv-us:TheYoungTurks.us": "https://i.imgur.com/XDNXJCl.png",
  "stremtv-us:ThisOldHouse.us": "https://i.imgur.com/nrVLyE6.png",
  "stremtv-us:TinTV.us": "https://i.imgur.com/hMqGs94.png",
  "stremtv-us:TinyHouseNation.us": "https://i.imgur.com/ai1P06C.png",
  "stremtv-us:ToonGoggles.us": "https://i.imgur.com/JMnxswq.png",
  "stremtv-us:ToonamiAftermath.us": "https://i.imgur.com/aSjhZK7.png",
  "stremtv-us:Tooncast.us": "https://i.imgur.com/3yXRbQy.png",
  "stremtv-us:TopStoriesbyNewsy.us": "https://i.imgur.com/UfN6aAi.png",
  "stremtv-us:TribecaChannel.us": "https://i.imgur.com/JCpFAll.png",
  "stremtv-us:TrueCrimeNow.us": "https://i.imgur.com/Y6Hix17.png",
  "stremtv-us:UCTV.us": "https://i.imgur.com/ehMz9T5.png",
  "stremtv-us:UNWebTV.us": "https://i.imgur.com/UcAwBep.png",
  "stremtv-us:USANetworkLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/USA_Network_logo_%282016%29.svg/960px-USA_Network_logo_%282016%29.svg.png",
  "stremtv-us:USATODAY.us": "https://i.imgur.com/37K0AZX.png",
  "stremtv-us:Unbeaten.us": "https://i.imgur.com/LmkNt3v.png",
  "stremtv-us:UndercoverBossGlobal.us": "https://i.imgur.com/O9lwu23.png",
  "stremtv-us:UniMas.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Logo_UniM%C3%A1s_2021.svg/960px-Logo_UniM%C3%A1s_2021.svg.png",
  "stremtv-us:Unidentified.us": "https://i.imgur.com/naYszow.jpg",
  "stremtv-us:UniversalCinema.us": "https://i.imgur.com/XxfET68.png",
  "stremtv-us:UniversalCrime.us": "https://i.imgur.com/OwSlGMu.png",
  "stremtv-us:UniversalTVLatinAmerica.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Universal_TV_logo.svg/960px-Universal_TV_logo.svg.png",
  "stremtv-us:Univision.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/Logo_Univision_2019.svg/960px-Logo_Univision_2019.svg.png",
  "stremtv-us:UnivisionTlnovelas.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Univision_tlnovelas_%282019%29.svg/960px-Univision_tlnovelas_%282019%29.svg.png",
  "stremtv-us:UnsolvedMysteries.us": "https://i.imgur.com/De3khrX.png",
  "stremtv-us:VICETV.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Vice_TV_logo.svg/960px-Vice_TV_logo.svg.png",
  "stremtv-us:VSiN.us": "https://i.imgur.com/C4wIRxg.png",
  "stremtv-us:VegasLifeTV.us": "https://i.imgur.com/G7lONcu.png",
  "stremtv-us:VelayatTVNetwork.us": "https://i.imgur.com/bRQSzhs.png",
  "stremtv-us:VevoHipHop.us": "https://i.imgur.com/Lbc9cYw.png",
  "stremtv-us:VevoLatino.us": "https://i.imgur.com/D7SwmuB.png",
  "stremtv-us:VevoPop.us": "https://i.imgur.com/dZHktKR.png",
  "stremtv-us:VevoRetroRock.us": "https://i.imgur.com/H1Aap4E.png",
  "stremtv-us:VidaMejorTV.us": "https://i.imgur.com/1hJ16i0.png",
  "stremtv-us:VideoMixTV.us": "https://i.imgur.com/nyLrIPP.png",
  "stremtv-us:VoATV.us": "https://i.imgur.com/rtRnlqN.png",
  "stremtv-us:VoATVPersian.us": "https://i.imgur.com/TmqComb.png",
  "stremtv-us:W14DKD141.us": "https://i.imgur.com/TjQP7kS.png",
  "stremtv-us:W14DKD142.us": "https://upload.wikimedia.org/wikipedia/commons/9/98/NewsNetLogo2022.png",
  "stremtv-us:WATCDT571.us": "https://i.imgur.com/FhIRe7O.png",
  "stremtv-us:WATCDT572.us": "https://i.imgur.com/RAfuLul.png",
  "stremtv-us:WBTV641.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/CBS_logo_%282020%29.svg/960px-CBS_logo_%282020%29.svg.png",
  "stremtv-us:WCETVDigitalChannel318.us": "https://i.imgur.com/l0UO27k.png",
  "stremtv-us:WCOT.us": "https://i.imgur.com/WMUBDzY.jpg",
  "stremtv-us:WGGSTV161.us": "https://i.imgur.com/Btw83JA.png",
  "stremtv-us:WHOHTV.us": "https://i.imgur.com/jTD9nLE.png",
  "stremtv-us:WLMB.us": "https://i.imgur.com/KeELZ1Y.png",
  "stremtv-us:WPSTV.us": "https://i.imgur.com/zwzmwse.jpg",
  "stremtv-us:WSOCNow.us": "https://i.imgur.com/tUb1mdc.png",
  "stremtv-us:WVCULP.us": "https://upload.wikimedia.org/wikipedia/en/0/0f/WVCU-LP_2015.PNG",
  "stremtv-us:WVVHCD181.us": "https://upload.wikimedia.org/wikipedia/en/3/3f/WVVH-CD_logo.png",
  "stremtv-us:WWONTVChannel48.us": "https://i.imgur.com/l4qHAq6.png",
  "stremtv-us:WantedDeadorAlive.us": "https://i.imgur.com/vaSXaFp.png",
  "stremtv-us:WarnerChannel.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Warner_Channel_2026.svg/960px-Warner_Channel_2026.svg.png",
  "stremtv-us:WarnerTVAsia.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Warner2018LA.png/960px-Warner2018LA.png",
  "stremtv-us:WatchitKID.us": "https://i.imgur.com/YNx0j1b.png",
  "stremtv-us:WatchitScream.us": "https://i.imgur.com/bz3Caum.png",
  "stremtv-us:WaypointTV.us": "https://i.imgur.com/9vvlJN9.png",
  "stremtv-us:WeHoTV.us": "https://i.imgur.com/p3L2vSL.png",
  "stremtv-us:WeTV.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Wetv-july-2024-logo.svg/3840px-Wetv-july-2024-logo.svg.png",
  "stremtv-us:WeatherNation.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/WeatherNation_Logo.svg/960px-WeatherNation_Logo.svg.png",
  "stremtv-us:WeatherSpy.us": "https://i.imgur.com/yHUUIIz.png",
  "stremtv-us:WhitePlainsCommunityMedia.us": "https://i.imgur.com/XGQfBbW.png",
  "stremtv-us:WillowSports.us": "https://provider-static.plex.tv/epg/cms/production/acf3d1d8-c53e-49ca-86e9-0d9410b106b4/Willow_Sports_dark_Background_1500_1000_color.png",
  "stremtv-us:WineWatchesWhiskey.us": "https://i.imgur.com/MN89dfS.png",
  "stremtv-us:WipeoutXtra.us": "https://i.imgur.com/UDeCRW1.png",
  "stremtv-us:Wired2FishTV.us": "https://i.imgur.com/zAtt7oq.png",
  "stremtv-us:WomensSportsNetwork.us": "https://i.imgur.com/rhIwUcQ.png",
  "stremtv-us:WorldHarvestTV.us": "https://i.imgur.com/xtbkDDN.png",
  "stremtv-us:WorldPokerTour.us": "https://i.imgur.com/98kLMjj.png",
  "stremtv-us:XploreTV.us": "https://i.imgur.com/WaGRlFO.png",
  "stremtv-us:YTATV.us": "https://i.imgur.com/UDpDJ7v.png",
  "stremtv-us:YesNetwork.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/YES_Network_logo.svg/960px-YES_Network_logo.svg.png",
  "stremtv-us:YouDotGov.us": "https://i.imgur.com/4Mc7baR.png",
  "stremtv-us:YoungHollywood.us": "https://i.imgur.com/X27MGHd.png",
  "stremtv-us:YoutooAmerica.us": "https://i.imgur.com/QNGYhNw.png",
  "stremtv-us:YuGiOhenespanol.us": "https://i.imgur.com/VH8RiHg.png",
  "stremtv-us:Yuma77.us": "https://i.imgur.com/KBriwwj.png",
  "stremtv-us:YumaChannel72.us": "https://i.imgur.com/QsFBCWv.png",
  "stremtv-us:YumaChannel73.us": "https://i.imgur.com/QsFBCWv.png",
  "stremtv-us:beINSPORTSXTRAenEspanol.us": "https://i.imgur.com/V562tpO.png",
  "stremtv-us:bonappetit.us": "https://i.imgur.com/YhFFxlE.png",
  "stremtv-us:iHolyfieldTV.us": "https://i.imgur.com/GBeBWNR.png",
  "stremtv-us:pocketwatch.us": "https://i.imgur.com/T0V90Lz.png",
  "stremtv-us:theDoveTV.us": "https://i.imgur.com/ULtuRsj.png",
  "stremtv-us:truTV.us": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/TruTV_2014.svg/960px-TruTV_2014.svg.png",
  // W121ZLOGO174D: 81 additional exact-ID proposed logos accepted by user.
  "stremtv-us:30AGeorgiaHollywoodReview.us": "https://images.axios.com/JiG3RuYBwpU_WZFeU6HHjt03FAU=/111x0:1191x1080/320x320/2023/11/09/1699558891265.jpg",
  "stremtv-us:30ALionelNation.us": "https://m.media-amazon.com/images/I/71dgsQwVcNL.png",
  "stremtv-us:30ALoomeredTV.us": "https://cbs12.com/resources/media/0c1ecad8-fb09-4bb2-beaa-fc561dfe624a-small21x9_LoomerStill.jpg?1603419052801",
  "stremtv-us:30ALuxeLifeDiscovered.us": "https://m.media-amazon.com/images/I/51FJ5A0mEyL.jpg",
  "stremtv-us:30ARidiculousTV.us": "https://30a.media/wp-content/uploads/2023/08/pzaz-30atv-2-230x366-ridiculous.jpg",
  "stremtv-us:30ATelevisionChannel.us": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTTHiYfIB01K44LIBG81aEGAmDuIWw8MA0f2w&s",
  "stremtv-us:30AWeLoveCars.us": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQxroqfE_hvEApKMQx03sSYXPeEh4ClaF5QSa8XfRwJW_So3vfSN0CjqzxN30H-qEBswqU&usqp=CAU",
  "stremtv-us:AVIRewind.us": "https://zplay.cl/LogosV2/AVIREWINDS_NEW.png",
  "stremtv-us:Akaku53.us": "https://www.akaku.org/wp-content/uploads/bb-plugin/cache/Channel53-147x150-square.png",
  "stremtv-us:Akaku54.us": "https://www.akaku.org/wp-content/uploads/bb-plugin/cache/Channel54-147x150-square.png",
  "stremtv-us:Akaku55.us": "https://www.akaku.org/wp-content/uploads/bb-plugin/cache/Channel55-147x150-square.png",
  "stremtv-us:AmericanHorrors.us": "https://image.roku.com/developer_channels/prod/16f5571a82819e8992a748c70b256cbe63105f4b546b73d129668dc2cb701d91.png",
  "stremtv-us:Ameritrade.us": "https://images-na.ssl-images-amazon.com/images/I/71CZKwin9mL.png",
  "stremtv-us:AneflixLive.us": "https://cdn.pixabay.com/photo/2021/06/26/18/11/live-6366830_960_720.png",
  "stremtv-us:AspireTVLife.us": "https://press.upentertainment.com/wp-content/uploads/2022/03/aspire-tv-life-logo.jpg",
  "stremtv-us:Atlas.us": "https://whiplash.cc/assets/img/channels/atlas.png",
  "stremtv-us:BBCAmerica.us": "https://imgx.fubo.tv/station_logos/bbc-america_c.png",
  "stremtv-us:BarkTV.us": "https://images.squarespace-cdn.com/content/v1/6a233007201fda6808a47ff9/f4f45cba-d340-4963-860a-37edaf91bc7f/BarkTV_Horizontal_Color.png",
  "stremtv-us:CBSNewsBayArea.us": "https://static.wikia.nocookie.net/logopedia/images/1/1a/Logo-cbsn-bayarea-1920x1080.jpg/revision/latest/scale-to-width-down/512",
  "stremtv-us:CampSpoopy.us": "https://img2.static-ottera.com/prod/tg/linear_channel/logo/640x360/camp-spoopy-2021_1920-x-1080_option-5.jpg",
  "stremtv-us:Channel10.us": "https://spcity.org/ImageRepository/Document?documentID=4246",
  "stremtv-us:ComercioTV.us": "https://www.amagi.com/hubfs/Group%202-3.png",
  "stremtv-us:DiscoveryKidsLatinAmerica.us": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7f/Discovery_Kids_2021_2D_sin_wordmark.svg/960px-Discovery_Kids_2021_2D_sin_wordmark.svg.png",
  "stremtv-us:DroneTV.us": "https://i.ibb.co/S71C9RJC/dronetv.webp",
  "stremtv-us:DuckHuntingTV.us": "https://image.roku.com/developer_channels/prod/b2a80f0a20fc338f22a8289f23d20d19d958470ff1b8df3845c57cbc54ec1245.png",
  "stremtv-us:ESPN8TheOcho.us": "https://images.fubo.tv/channel-config-ui/station-logos/on-dark/espn_8_the_ocho_bw.png",
  "stremtv-us:FierroaFondoTV.us": "https://pbs.twimg.com/profile_images/1903618079696773120/maQJpd9__400x400.jpg",
  "stremtv-us:FloHockey.us": "https://images.fubo.tv/channel-config-ui/station-logos/on-dark/flohockey-white.png",
  "stremtv-us:FloRacing.us": "https://a.jsrdn.com/hls/22883/floracing-247/logo_20231219_225054_24.png",
  "stremtv-us:FoxNewsRadio.us": "https://radio.foxnews.com/wp-content/uploads/2017/10/default_logo-150x150.png",
  "stremtv-us:GillettePublicAccessTelevisionChannel189.us": "https://yt3.googleusercontent.com/ytc/AGIKgqMoPQ32FU8R2lR71LXhYrC3tCHfjJEXcm6E9PEO=s176-c-k-c0x00ffffff-no-rj",
  "stremtv-us:GillettePublicAccessTelevisionChannel190.us": "https://yt3.googleusercontent.com/ytc/AGIKgqMoPQ32FU8R2lR71LXhYrC3tCHfjJEXcm6E9PEO=s176-c-k-c0x00ffffff-no-rj",
  "stremtv-us:GillettePublicAccessTelevisionChannel192.us": "https://yt3.googleusercontent.com/ytc/AGIKgqMoPQ32FU8R2lR71LXhYrC3tCHfjJEXcm6E9PEO=s176-c-k-c0x00ffffff-no-rj",
  "stremtv-us:HmongTVNetwork.us": "https://yt3.googleusercontent.com/aj3kdBQTgfxP-bDnleou4m1ykjPRFexvfTZZuvWlNc75Hn9-NTqXYEdEJ_KOcTSsbKj24K1B9BM=s512-c-k-c0x00ffffff-no-rj",
  "stremtv-us:JBS.us": "https://yt3.googleusercontent.com/ytc/AIdro_lDWY-W9dD7UvLlp1NuWLJs1wV6t_KjeOT-1iVVIGuLZ8U=s512-c-k-c0x00ffffff-no-rj",
  "stremtv-us:JewishLifeTelevision.us": "https://yt3.googleusercontent.com/i6ETvgNzA8vvGCo-Ih6eo2XZUwz2VVMnstLyNZVXBlwa4uOeUIEl-3tzphB8phJaibe-FPQ5Fw=s512-c-k-c0x00ffffff-no-rj",
  "stremtv-us:JoelOsteenNetwork.us": "https://www.tablotv.com/wp-content/uploads/2025/05/Osteen_black.png",
  "stremtv-us:KentuckyEducationalTelevision.us": "https://static.wikia.nocookie.net/tvstations/images/2/29/WKLE.png/revision/latest?cb=20210528010650",
  "stremtv-us:LacrosseTV.us": "https://yt3.googleusercontent.com/ytc/AIdro_m_xSJFydxZ9QBU-85OuchjmzS0Bo0_Tukmk7to8hBfyl8=s512-c-k-c0x00ffffff-no-rj",
  "stremtv-us:LakeHavasuCity4.us": "https://yt3.googleusercontent.com/ytc/AIdro_lQ_vy6By43AoSdSQbFUzQePU0NWWIM-uzsAqnbbQXAql4=s512",
  "stremtv-us:LawCrime.us": "https://yt3.googleusercontent.com/CRP3YudPa55QypbDnIvuh3erLZTsn2HK8ESR-2fJFFiLJVf7US2CKQELCKK_UowmHA3wCjAdxg=s512-c-k-c0x00ffffff-no-rj",
  "stremtv-us:LoneStar.us": "https://xstreamcp-assets-msp.streamready.in/assets/DISTROTV/LIVECHANNEL/666988e3bac4421ebc533621/images/logo_20231219_215208_70.png",
  "stremtv-us:LucasFriends.us": "https://i.postimg.cc/cLft65S5/Dmin-CTnq-400x400.jpg",
  "stremtv-us:MaverickBlackCinema.us": "https://images.fubo.tv/station_logos/maverick_black_cinema_c.png",
  "stremtv-us:Maxcine.us": "https://gia.tv/streams/pptv/208138.png",
  "stremtv-us:Maxcine2.us": "https://gia.tv/streams/pptv/209163.png",
  "stremtv-us:MaxcineComedy.us": "https://gia.tv/streams/pptv/208730.png",
  "stremtv-us:MaxcineFamily.us": "https://gia.tv/streams/pptv/208817.png",
  "stremtv-us:MaxcineKids.us": "https://gia.tv/streams/pptv/209909.png",
  "stremtv-us:MegaExtrenoHD.us": "https://cdn.vaughnsoft.net/profile/1792355588/mega_extremo.jpg",
  "stremtv-us:MeritStreet.us": "https://static.wikia.nocookie.net/logopedia/images/1/1d/Merit_Street_Media_2024_1.svg/revision/latest/scale-to-width-down/512",
  "stremtv-us:MetaleitorTV.us": "https://new.opencaster.com/uploads/logos/logo_14_1752798826.png",
  "stremtv-us:MinisterioLaVozDeUnRemanenteTV.us": "https://new.opencaster.com/uploads/logos/logo_188_1754869413.png",
  "stremtv-us:NashBridges.us": "https://images.pluto.tv/channels/666021cccb3ea10008406866/colorLogoPNG.png",
  "stremtv-us:NationalIranianCongressTV.us": "https://iraniancongress.com/tv/logo.png",
  "stremtv-us:News12PlusHudsonValley.us": "https://i.ibb.co/cKkdC203/news12plus-HV.jpg",
  "stremtv-us:News12PlusNewYork.us": "https://i.ibb.co/tThKYM09/news12plus-NYC.jpg",
  "stremtv-us:RTNChicago.us": "https://i.ibb.co/wwchqYk/889dc1-937ba3d8d4ed4331a668a1c544766318-mv2.png",
  "stremtv-us:RTViUS.us": "https://www.einpresswire.com/image/large/960869/logo-rtvi-us.png#676x536",
  "stremtv-us:RallyTV.us": "https://i.postimg.cc/WtLq2C7c/logo-Rally-Tv1.png",
  "stremtv-us:Roar.us": "https://iili.io/FxYNwOB.md.png",
  "stremtv-us:SmurfTV.us": "https://img.static-ottera.com/prod/tg/linear_channel/thumbnails/widescreen/EJIyYyBMkbW5UntSCAkGp-uLla7Z8KWHvDjyEqoOf3k.jpg",
  "stremtv-us:TVSBowlingNetwork.us": "https://www.watchyour.tv/channels/logo/tvs-bowling-network.jpg",
  "stremtv-us:TVSConsumerDirect.us": "https://www.watchyour.tv/channels/logo/tvs-consumer-direct.jpg",
  "stremtv-us:TVSFlashbackNetwork.us": "https://www.watchyour.tv/channels/logo/tvs-flashback-network.jpg",
  "stremtv-us:TVSVintageNetwork.us": "https://www.watchyour.tv/channels/logo/tvs-vintage-network.jpg",
  "stremtv-us:TalkinLiveClassicsTV.us": "https://play-lh.googleusercontent.com/qt4POaxei89y6DP7sRJlRNv-yo4jlG3HuVO2Jb54Rf6T7aJ-j7RLG2z4aY9YrU5d0Q=w240-h480-rw",
  "stremtv-us:TelePam.us": "https://i.ibb.co/xMYMyHh/telepammmm.png",
  "stremtv-us:TennisChannel2.us": "https://image-resizer-cloud-cdn.api.cms.amdvids.com/image/7382296F-97F6-4450-B77B-8FE331FC04F6/3-1x1.png",
  "stremtv-us:TheNest.us": "https://iili.io/JGqD21e.png",
  "stremtv-us:TrueCrimeNetwork.us": "https://www.truecrimenetworktv.com/sites/all/themes/jntheme/images/tcnetwork-logo-main.png",
  "stremtv-us:Vevo2K.us": "https://images.pluto.tv/channels/5fd7bca3e0a4ee0007a38e8c/featuredImage.jpg",
  "stremtv-us:Vevo70s.us": "https://images.pluto.tv/channels/5f32f26bcd8aea00071240e5/featuredImage.jpg",
  "stremtv-us:Vevo80s.us": "https://images.pluto.tv/channels/5fd7b8bf927e090007685853/featuredImage.jpg",
  "stremtv-us:Vevo90s.us": "https://images.pluto.tv/channels/5fd7bb1f86d94a000796e2c2/featuredImage.jpg",
  "stremtv-us:VevoCountry.us": "https://images.pluto.tv/channels/5da0d75e84830900098a1ea0/featuredImage.jpg",
  "stremtv-us:VevoRB.us": "https://images.pluto.tv/channels/5da0d83f66c9700009b96d0e/featuredImage.jpg",
  "stremtv-us:Whiplash.us": "https://whiplash.cc/assets/img/channels/whiplash.png",
  "stremtv-us:WhiplashCinema.us": "https://whiplash.cc/assets/img/channels/whiplashcinema.png",
  "stremtv-us:WhiplashII.us": "https://whiplash.cc/assets/img/channels/whiplash2.png",
  "stremtv-us:WindowTV.us": "https://whiplash.cc/assets/img/channels/windowtv.png",
};
const w174bProtectedStremTvIds: ReadonlySet<string> = new Set([
  "stremtv-us:DareToDreamNetwork.us",
  "stremtv-us:3ABNEnglish.us",
  "stremtv-us:3ABNFrench.us",
  "stremtv-us:3ABNInternational.us",
  "stremtv-us:3ABNKids.us",
  "stremtv-us:3ABNLatino.us",
  "stremtv-us:3ABNPraiseHimMusicNetwork.us",
  "stremtv-us:3ABNProclaimNetwork.us"
]);

// W121ZEPG177V -- six verified exact channel identity artwork candidates.
// No title-based fuzzy matching, no EPG or stream changes.
const w177vVerifiedLogos: Readonly<Record<string, string>> = {
  'org.plutotv:dark-shadows': 'https://i.imgur.com/PUryyBI.png',
  'org.plutotv:doctor-who': 'https://i.imgur.com/pMMabI3.png',
  'stremtv-us:FoxNewsRadio.us': 'https://radio.foxnews.com/wp-content/uploads/2017/10/default_logo-150x150.png',
  'org.plutotv:pluto-tv-kids-halloween': 'https://i.imgur.com/Cx7xgf4.png',
  'org.plutotv:stingray-cityscapes': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRZlXPCl4ze9lr2DnadYazKxuyyEEWmgO1O1Q&s',
  'org.plutotv:stingray-holidayscapes': 'https://images.plex.tv/photo?size=large-1920&scale=1&url=https%3A%2F%2Fprovider-static.plex.tv%2Fepg%2Fcms%2Fproduction%2F9cb4b15c-8244-4499-ae2c-9a92d4cdff6d%2F13895_SHS_Plex_Logos_Holidays_1500x1000_Dark-Background.png',
};

// W121ZEPG178E - STAGED exact-ID alternative station logos, no data or stream changes.
const w178eExactVerifiedImageResponses: Readonly<Record<string,string>> = {"stremtv-us:SouthParkKennyCollection.us":"https://images.pluto.tv/channels/65d879bd0d4561000805d190/colorLogoPNG.png","stremtv-us:CSINYenespanol.us":"https://images.pluto.tv/channels/632b606e12a67b0007c9e371/colorLogoPNG_1731837281479.png","stremtv-us:MTVPlutoTV.us":"https://images.pluto.tv/channels/5fab088b3279760007d4e4fd/colorLogoPNG.png","stremtv-us:ParamountPlusPicks.us":"https://images.pluto.tv/channels/5ff8c708653d080007361b14/colorLogoPNG.png","stremtv-us:PlutoTVCanalUOL.us":"https://images.pluto.tv/channels/64b9370b409629000802d32b/colorLogoPNG.png","stremtv-us:ComedyCentralAnimation.us":"https://images.pluto.tv/channels/64f8a949f5b5e4000862467c/colorLogoPNG.png","stremtv-us:TheJudgeJudyChannel.us":"https://images.pluto.tv/channels/62e92e536f28870007fa9b3a/colorLogoPNG.png","stremtv-us:CMTEqualPlay.us":"https://images.pluto.tv/channels/5f68f53eb1e5800007390bf8/colorLogoPNG.png","stremtv-us:iCarly.us":"https://images.pluto.tv/channels/620ff0a01f9e8700076c6f9d/colorLogoPNG.png","stremtv-us:WalkerTexasRanger.us":"https://images.pluto.tv/channels/62a0aefc7c5f9f00075b4e24/colorLogoPNG.png","stremtv-us:Classica.us":"https://images.pluto.tv/channels/5f779951372da90007fd45e8/colorLogoPNG.png","stremtv-us:News12NewYork.us":"https://images.pluto.tv/channels/5fff49cfb5cd4f0007c2b0dc/colorLogoPNG.png","stremtv-us:ForensicFiles.us":"https://images.pluto.tv/channels/6181241c1a35d50007874c27/colorLogoPNG.png","stremtv-us:BestofTheDrewBarrymoreShow.us":"https://images.pluto.tv/channels/62beb692cda2b10007d5fd76/colorLogoPNG.png","stremtv-us:SouthParkKyleCollection.us":"https://images.pluto.tv/channels/65d87a908145cb0008265c6d/colorLogoPNG.png","stremtv-us:PlutoTVReaction.us":"https://images.pluto.tv/channels/617b37b361e0fd0008cfd8c5/colorLogoPNG_1731837948814.png","stremtv-us:SouthParkCartmanCollection.us":"https://images.pluto.tv/channels/65d87a058145cb0008265c2e/colorLogoPNG.png","stremtv-us:ACCNetwork.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/acc-network-us.png","stremtv-us:PokerGo.us":"https://images.pluto.tv/channels/5fc54366b04b2300072e31af/colorLogoPNG.png","stremtv-us:InstantSaga.us":"https://images.pluto.tv/channels/60549e98061b5f000776866a/colorLogoPNG.png","stremtv-us:JornadanasEstrelasVoyager.us":"https://images.pluto.tv/channels/69162b1ef189e235142b17ab/colorLogoPNG.png","stremtv-us:SouthPark.us":"https://images.pluto.tv/channels/61c098df897b9d00070375c8/colorLogoPNG.png","stremtv-us:BlackInkCrew.us":"https://images.pluto.tv/channels/5d51e2bceca5b4b2c0e06c50/colorLogoPNG_1731835399139.png","stremtv-us:DatingDisasters.us":"https://images.pluto.tv/channels/651f239d9c7aeb0008286823/colorLogoPNG.png","stremtv-us:PlutoTVSeriesDrama.us":"https://images.pluto.tv/channels/65f060d84e01740008d7421f/colorLogoPNG.png","stremtv-us:PlutoTVMinutoParaGanar.us":"https://images.pluto.tv/channels/5e46e64dc73db400094b5f0b/colorLogoPNG.png","stremtv-us:Dynasty.us":"https://images.pluto.tv/channels/622f48de713e510007f85808/colorLogoPNG.png","stremtv-us:BestofDrPhil.us":"https://images.pluto.tv/channels/666815f24b9fb400083f7e31/colorLogoPNG.png","stremtv-us:Cheers.us":"https://images.pluto.tv/channels/63e389dcc111bc0008ee5b8c/colorLogoPNG.png","stremtv-us:PlutoTVAnimais.us":"https://images.pluto.tv/channels/6474aa984cfc2c0008883a92/colorLogoPNG.png","stremtv-us:WildNOut.us":"https://images.pluto.tv/channels/5d48678d34ceb37d3c458a55/colorLogoPNG.png","stremtv-us:PeppaPig.us":"https://images.pluto.tv/channels/5d14fb6c84dd37df3b4290c5/colorLogoPNG_1730733871298.png","stremtv-us:MorePlutoTVComedy.us":"https://images.pluto.tv/channels/62e91c3add66e00007eeb24c/colorLogoPNG.png","stremtv-us:MTVBiggestPop.us":"https://images.pluto.tv/channels/65410176770cf1000866bf31/colorLogoPNG.png","stremtv-us:GolazoNetwork.us":"https://images.pluto.tv/channels/63a0e33a45264d000850ed7e/colorLogoPNG_1731835813404.png","stremtv-us:MTVConMiEx.us":"https://images.pluto.tv/channels/638693db857364000781b471/colorLogoPNG.png","stremtv-us:PlutoTVComedyMovies.us":"https://images.pluto.tv/channels/62ea3d24b8e02600071fa296/colorLogoPNG.png","stremtv-us:CineAdrenalina.us":"https://images.pluto.tv/channels/5d8d164d92e97a5e107638d2/colorLogoPNG.png","stremtv-us:Nickelodeonenespanol.us":"https://images.pluto.tv/channels/5d8d08395f39465da6fb3ec4/colorLogoPNG.png","stremtv-us:HighwaytoHeaven.us":"https://images.pluto.tv/channels/68bff9a63efb41cd97562e46/colorLogoPNG.png","stremtv-us:BeyondBeliefFactorFiction.us":"https://images.pluto.tv/channels/611f85396abc84000738417b/colorLogoPNG.png","stremtv-us:PlutoTVEstilodeVida.us":"https://images.pluto.tv/channels/5dcde0657444a40009cd2422/colorLogoPNG.png","stremtv-us:PlutoTVCompetition.us":"https://images.pluto.tv/channels/603fde9026ecbf0007752c2c/colorLogoPNG.png","stremtv-us:PlutoTVFBI.us":"https://images.pluto.tv/channels/693adae77f21340ef9746f56/colorLogoPNG.png","stremtv-us:LittleStarsUniverse.us":"https://images.pluto.tv/channels/51c75f7bb6f26ba1cd00002f/colorLogoPNG.png","stremtv-us:Runtime.us":"https://images.pluto.tv/channels/62c5d80dc6de440007e033eb/colorLogoPNG.png","stremtv-us:CSINY.us":"https://images.pluto.tv/channels/62f54c6439183b000769fb8f/colorLogoPNG_1731837277521.png","stremtv-us:PlutoTVSnooker900.us":"https://images.pluto.tv/channels/68ac55bb3efb41cd979a65ec/colorLogoPNG.png","stremtv-us:MTVDating.us":"https://images.pluto.tv/channels/64f8a0c230ab3300084369b8/colorLogoPNG.png","stremtv-us:PlutoTVTurbo.us":"https://images.pluto.tv/channels/6014761dfb91870008ea6463/colorLogoPNG.png","stremtv-us:PlutoTVSanctuary.us":"https://images.pluto.tv/channels/63eb57d6c111bc0008fe2658/colorLogoPNG.png","stremtv-us:BeverlyHills90210.us":"https://images.pluto.tv/channels/60afb576053df900076fa2f0/colorLogoPNG.png","stremtv-us:LEGOKidsTV.us":"https://images.pluto.tv/channels/60fb01a24795a6000762fe83/colorLogoPNG.png","stremtv-us:MTVFlowLatino.us":"https://images.pluto.tv/channels/62b218fc511d4b00070ddc0c/colorLogoPNG.png","stremtv-us:MTVenEspanol.us":"https://images.pluto.tv/channels/5cf96d351652631e36d4331f/colorLogoPNG-1641928405432.png","stremtv-us:Numbers.us":"https://images.pluto.tv/channels/62bebb3a67307900077a7f9d/colorLogoPNG.png","stremtv-us:Cineenespanol.us":"https://images.pluto.tv/channels/5cf96b1c4f1ca3f0629f4bf0/colorLogoPNG.png","stremtv-us:PlutoTVHumor.us":"https://images.pluto.tv/channels/61c0974945b45d0007aaa5ac/colorLogoPNG.png","stremtv-us:YuGiOh.us":"https://images.pluto.tv/channels/5fceaab478f2af00080ff51f/colorLogoPNG.png","stremtv-us:JornadanasEstrelasANovaGeracao.us":"https://images.pluto.tv/channels/69162ad79505d0f3b1ebf07d/colorLogoPNG.png","stremtv-us:PlutoTVBangBang.us":"https://images.pluto.tv/channels/663b9dc7cb3ea10008f1a0ce/colorLogoPNG.png","stremtv-us:BeverlyHillbillies.us":"https://images.pluto.tv/channels/5f7796e470510900070d4e3d/colorLogoPNG_1731835751688.png","stremtv-us:PlutoTVTrueCrime.us":"https://images.pluto.tv/channels/61c097ec8bb1830008e3f962/colorLogoPNG.png","stremtv-us:Crime360.us":"https://images.pluto.tv/channels/657880c46e4f6a00087404d0/colorLogoPNG.png","stremtv-us:AnthonyBourdainPartsUnknown.us":"https://images.pluto.tv/channels/69173ce8abd4703b27f71d44/colorLogoPNG.png","stremtv-us:PlutoTVMilitary.us":"https://images.pluto.tv/channels/5bb3fea0f711fd76340eebff/colorLogoPNG.png","stremtv-us:BeyondtheGates.us":"https://images.pluto.tv/channels/687ff00ff6bc08130f16ab81/colorLogoPNG_1755074273752.png","stremtv-us:PlutoTVScience.us":"https://images.pluto.tv/channels/5d767b4889bca2ce7b73ef2e/colorLogoPNG.png","stremtv-us:PlutoTVFilmesNacionais.us":"https://images.pluto.tv/channels/5f5a545d0dbf7f0007c09408/colorLogoPNG.png","stremtv-us:PlutoTVCineClasico.us":"https://images.pluto.tv/channels/609059dc63be6e0007b4eca6/colorLogoPNG.png","stremtv-us:SouthParkColeccionStan.us":"https://images.pluto.tv/channels/65df72db18036500081a8292/colorLogoPNG.png","stremtv-us:CurroJimenez.us":"https://images.pluto.tv/channels/5f1acd36779de70007a680d1/colorLogoPNG.png","stremtv-us:PlutoTVCozinha.us":"https://images.pluto.tv/channels/5f1ef23020a5ac0007e5e8ea/colorLogoPNG.png","stremtv-us:TheNewDetectives.us":"https://images.pluto.tv/channels/618147d2a814250007b42916/colorLogoPNG.png","stremtv-us:PlutoTVCineAccion.us":"https://images.pluto.tv/channels/5dcb62e63d4d8f0009f36881/colorLogoPNG.png","stremtv-us:PlutoTVViagens.us":"https://images.pluto.tv/channels/5f32d432d612e50007e56133/colorLogoPNG.png","stremtv-us:PlutoTVActionMovies.us":"https://images.pluto.tv/channels/62ea3c2e4823db00072788ed/colorLogoPNG.png","stremtv-us:PlutoTVAliens.us":"https://images.pluto.tv/channels/6806d65e84f24b70109485fa/colorLogoPNG.png","stremtv-us:Farscape.us":"https://images.pluto.tv/channels/699c1b4c9c3b075ecd513139/colorLogoPNG.png","stremtv-us:TelemundoTelenovelasClasicas.us":"https://images.pluto.tv/channels/5cf96cc422df39f1a338d165/colorLogoPNG.png","stremtv-us:LoveHipHop.us":"https://images.pluto.tv/channels/5d51ddf0369acdb278dfb05e/colorLogoPNG.png","stremtv-us:PlutoTVNovelasdeVenezuela.us":"https://images.pluto.tv/channels/6474a86917f5e100089a0c1c/colorLogoPNG.png","stremtv-us:LosarchivosdelFBI.us":"https://images.pluto.tv/channels/5e67d41b93312100076f3fca/colorLogoPNG.png","stremtv-us:PlutoTVSeries.us":"https://images.pluto.tv/channels/5dcde1317578340009b751d0/colorLogoPNG.png","stremtv-us:SouthParkColeccionCartman.us":"https://images.pluto.tv/channels/65df731cec9fda0008b7aa8d/colorLogoPNG.png","stremtv-us:AllRealitybyWEtv.us":"https://images.pluto.tv/channels/6a205abba7b5a6c560b8ac25/colorLogoPNG.png","stremtv-us:Misteriossinresolver.us":"https://images.pluto.tv/channels/5f610042272f68000867685b/colorLogoPNG.png","stremtv-us:PlutoClassicMovieWesterns.us":"https://images.pluto.tv/channels/66dad50215d2c60008d7afbd/colorLogoPNG.png","stremtv-us:ThePriceIsRight.us":"https://images.pluto.tv/channels/64c2214c2a7f2200089a0c4b/colorLogoPNG.png","stremtv-us:KidsMovieClub.us":"https://images.pluto.tv/channels/5db0ad56edc89300090d2ebb/colorLogoPNG.png","stremtv-us:DiffrentStrokesArnold.us":"https://images.pluto.tv/channels/61f1d27a189ed10007b7393e/colorLogoPNG.png","stremtv-us:PlutoTVSeriesdeAccion.us":"https://images.pluto.tv/channels/6479ff1c17f5e10008ad2797/colorLogoPNG.png","stremtv-us:PlutoTVCineComediaRomantica.us":"https://images.pluto.tv/channels/62545ed3dab4380007582f7c/colorLogoPNG.png","stremtv-us:BETClassicsPlutoTV.us":"https://images.pluto.tv/channels/60f85644a9493e0007a1f035/colorLogoPNG_1759339662769.png","stremtv-us:ComedyCentralenEspanol.us":"https://images.pluto.tv/channels/5cf96dad1652631e36d43320/colorLogoPNG_1731837238379.png","stremtv-us:StarTrekVoyager.us":"https://images.pluto.tv/channels/6a4b84a439c0e50c685e882c/colorLogoPNG.png","stremtv-us:SitcomLegends.us":"https://images.pluto.tv/channels/633354b63df9700007f6a1b7/colorLogoPNG.png","stremtv-us:PlutoTVRetroCrimeDrama.us":"https://images.pluto.tv/channels/630f1e6073bd1800082107f0/colorLogoPNG.png","stremtv-us:PlutoTVSeriesNovelescas.us":"https://images.pluto.tv/channels/691627e4a29a6123e400b3e0/colorLogoPNG.png","stremtv-us:NickelodeonPlutoTV.us":"https://images.pluto.tv/channels/5ca673e0d0bd6c2689c94ce3/colorLogoPNG_1785344578988.png","stremtv-us:MTVCatfish.us":"https://images.pluto.tv/channels/6177fe76691b2e000702c7fc/colorLogoPNG.png","stremtv-us:NCIS.us":"https://images.pluto.tv/channels/6319ec31c62c3f00075c90b1/colorLogoPNG.png","stremtv-us:NickelodeonToons.us":"https://images.pluto.tv/channels/645952687cb4b100084ed52e/colorLogoPNG.png","stremtv-us:PlutoTVCineCrime.us":"https://images.pluto.tv/channels/6479ff764f5ba5000878dfe2/colorLogoPNG.png","stremtv-us:PFLMMA.us":"https://images.pluto.tv/channels/64f6163a30ab3300083d870e/colorLogoPNG.png","stremtv-us:Heleneetlesgarcons.us":"https://images.pluto.tv/channels/604f8de01b479400078fb1e7/colorLogoPNG.png","stremtv-us:PlutoTVVelocidad.us":"https://images.pluto.tv/channels/5dd6dc7480e3550009133d4a/colorLogoPNG.png","stremtv-us:DocMartin.us":"https://images.pluto.tv/channels/62b1e5e77d15410007f798c6/colorLogoPNG.png","stremtv-us:PlutoTVAnimeAcao.us":"https://images.pluto.tv/channels/604b79c558393100078faeef/colorLogoPNG.png","stremtv-us:DCCMakingtheTeam.us":"https://images.pluto.tv/channels/5d40855b3fb0855028c99b6f/colorLogoPNG.png","stremtv-us:PlutoTVFilmesAventura.us":"https://images.pluto.tv/channels/66c79a4262e5510008ff68a5/colorLogoPNG.png","stremtv-us:SmithsonianChannelSelects.us":"https://images.pluto.tv/channels/61fb988e032c0100077d5252/colorLogoPNG.png","stremtv-us:CSIenespanol.us":"https://images.pluto.tv/channels/604928d54a4f730007ff76bc/colorLogoPNG.png","stremtv-us:HeyArnold.us":"https://images.pluto.tv/channels/66c79221b1a34600087e264d/colorLogoPNG.png","stremtv-us:ClassicMovieWesterns.us":"https://images.pluto.tv/channels/61f33318210549000806a530/colorLogoPNG.png","stremtv-us:PlutoTVCineSuspenso.us":"https://images.pluto.tv/channels/5ddc4e8bcbb9010009b4e84f/colorLogoPNG.png","stremtv-us:PlutoTVCrimeDrama.us":"https://images.pluto.tv/channels/62e92708a7ce600007b2676a/colorLogoPNG.png","stremtv-us:CrimePlusInvestigation.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/crime-and-investigation-us.png","stremtv-us:PlutoTVDramasCoreanos.us":"https://images.pluto.tv/channels/6185a9a88b2ce30007de5128/colorLogoPNG.png","stremtv-us:PlutoTVCineInspirador.us":"https://images.pluto.tv/channels/6806d519fea7414f33f57016/colorLogoPNG.png","stremtv-us:TBS.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/tbs-us.png","stremtv-us:AcapulcoShore.us":"https://images.pluto.tv/channels/61a52615cbef2500072876e2/colorLogoPNG.png","stremtv-us:GirlfriendsFilms.us":"https://images.pluto.tv/channels/66ba1e4446762a000855cd87/colorLogoPNG.png","stremtv-us:BondiRescue.us":"https://images.pluto.tv/channels/660d66be7bcd8600087cfee5/colorLogoPNG.png","stremtv-us:PlutoTVPolicial.us":"https://images.pluto.tv/channels/678fdf9e3de7c8cf948e8824/colorLogoPNG.png","stremtv-us:AdrenalinaPuraTV.us":"https://images.pluto.tv/channels/61b793ccf571b80007b7a610/colorLogoPNG.png","stremtv-us:CrimenesImperfectos.us":"https://images.pluto.tv/channels/5e94cd036cc69d0007e8a1ba/colorLogoPNG.png","stremtv-us:BellatorMMA.us":"https://images.pluto.tv/channels/5ebc8688f3697d00072f7cf8/colorLogoPNG.png","stremtv-us:Elencantadordeperros.us":"https://images.pluto.tv/channels/61099f2b40d0640007fc5aa2/colorLogoPNG.png","stremtv-us:ThreesCompany.us":"https://images.pluto.tv/channels/64ca723a2bc49300081a8966/colorLogoPNG.png","stremtv-us:ParanormalState.us":"https://images.pluto.tv/channels/60804d85858bd00007c5d591/colorLogoPNG.png","stremtv-us:beINSPORTSXTRA.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/bein-sports-xtra-us.png","stremtv-us:QVC2.us":"https://images.pluto.tv/channels/67817323dd7846fe546940dd/colorLogoPNG.png","stremtv-us:Cops.us":"https://images.pluto.tv/channels/6400bc50953da40008b94668/colorLogoPNG.png","stremtv-us:Vayasemanita.us":"https://images.pluto.tv/channels/5f28009b150b2500077766b8/colorLogoPNG.png","stremtv-us:PlutoTVFranchiseFavorites.us":"https://images.pluto.tv/channels/68fbf8101d26140175db8b58/colorLogoPNG_1762383685562.png","stremtv-us:PlutoTVSeriesLatinas.us":"https://images.pluto.tv/channels/5dd837642c6e9300098ad484/colorLogoPNG.png","stremtv-us:PlutoTVFilmesdeLuta.us":"https://images.pluto.tv/channels/6806d62369aec5b19cd628c0/colorLogoPNG.png","stremtv-us:OANPlus.us":"https://images.pluto.tv/channels/5e7cf6c7b156d500078c5f44/colorLogoPNG.png","stremtv-us:BlueBloods.us":"https://images.pluto.tv/channels/6a15f7770ed14e790bab6449/colorLogoPNG.png","stremtv-us:NickelodeonClassico.us":"https://images.pluto.tv/channels/6824ce10c5d53e1351ceb8d1/colorLogoPNG.png","stremtv-us:BETComedyMovies.us":"https://images.pluto.tv/channels/68c32d88f56983aba40052bd/colorLogoPNG_1759246622596.png","stremtv-us:PlutoTVCars.us":"https://images.pluto.tv/channels/69c592dff0f1a7d732dc6e36/colorLogoPNG.png","stremtv-us:PlutoTVSeriesAcao.us":"https://images.pluto.tv/channels/6474ab1da51cb80008bfb5f4/colorLogoPNG.png","stremtv-us:PlutoTVRetroKid.us":"https://images.pluto.tv/channels/6408b41b83f58900081d91ad/colorLogoPNG.png","stremtv-us:MoreTVDrama.us":"https://images.pluto.tv/channels/613260e4bdb71c00070d63fa/colorLogoPNG.png","stremtv-us:SouthParkColecaoKenny.us":"https://images.pluto.tv/channels/65df704366eec8000898e32f/colorLogoPNG.png","stremtv-us:SketchyAF.us":"https://images.pluto.tv/channels/67882c1c7b11714b795c2008/colorLogoPNG.png","stremtv-us:Masadrenalina.us":"https://images.pluto.tv/channels/687fea9a4fa995eff284a1c8/colorLogoPNG_1755151031497.png","stremtv-us:PlutoTVDramaMovies.us":"https://images.pluto.tv/channels/62bdb0bcd707b9000739d2e5/colorLogoPNG.png","stremtv-us:MoreTrueCrime.us":"https://images.pluto.tv/channels/6532e6a9bdf3cf000887ab29/colorLogoPNG.png","stremtv-us:JornadanasEstrelasDeepSpaceNine.us":"https://images.pluto.tv/channels/69162af591700f4c4c135c95/colorLogoPNG.png","stremtv-us:NickelodeonClasico.us":"https://images.pluto.tv/channels/6824cda00101510f9eeaa011/colorLogoPNG.png","stremtv-us:SmithsonianChannelPlutoTV.us":"https://images.pluto.tv/channels/63a084934734f30007457b2c/colorLogoPNG.png","stremtv-us:BattlestarGalactica.us":"https://images.pluto.tv/channels/69d7ebff029c431826bd328e/colorLogoPNG_1776982986391.png","stremtv-us:BlazeLive.us":"https://images.pluto.tv/channels/5e46fba0c43b0d00096e5ac1/colorLogoPNG.png","stremtv-us:CineTerror.us":"https://images.pluto.tv/channels/5dcddf1ed95e740009fef7ab/colorLogoPNG.png","stremtv-us:BarRescue.us":"https://images.pluto.tv/channels/655f2ee6c0fc88000877d26c/colorLogoPNG.png","stremtv-us:OggyeasBaratasTontas.us":"https://images.pluto.tv/channels/63221bafdc6e110007b50270/colorLogoPNG.png","stremtv-us:PlutoTVRetro.us":"https://images.pluto.tv/channels/5f1212ad1728050007a523b8/colorLogoPNG.png","stremtv-us:DoraTV.us":"https://images.pluto.tv/channels/62e951258a26d40007b3034c/colorLogoPNG.png","stremtv-us:SpongeBobSquarePants.us":"https://images.pluto.tv/channels/63f87d057533d80008ab9549/colorLogoPNG.png","stremtv-us:SpikeOutdoors.us":"https://images.pluto.tv/channels/5c393cad2de254456f7ef8c2/colorLogoPNG.png","stremtv-us:SouthParkColeccionKyle.us":"https://images.pluto.tv/channels/65df73520d4561000817c29b/colorLogoPNG.png","stremtv-us:00sReplay.us":"https://images.pluto.tv/channels/62ba60f059624e000781c436/colorLogoPNG.png","stremtv-us:PlutoTVALaMexicana.us":"https://images.pluto.tv/channels/5dfcde52d28b09000a42d7a2/colorLogoPNG.png","stremtv-us:AlerteaMalibu.us":"https://images.pluto.tv/channels/60afaa535580be0007ac9ee4/colorLogoPNG.png","stremtv-us:PlutoTVHistory.us":"https://images.pluto.tv/channels/5d767b1c126c65d0a307355f/colorLogoPNG.png","stremtv-us:LogoPlutoTV.us":"https://images.pluto.tv/channels/5ce5a8954311f992edbe1da2/colorLogoPNG_1731836723261.png","stremtv-us:PlutoTVSeriesdeOtrosContinentes.us":"https://images.pluto.tv/channels/6806d570c178637410ae4962/colorLogoPNG.png","stremtv-us:BlackFamilySitcoms.us":"https://images.pluto.tv/channels/686d61503484d6073283059d/colorLogoPNG_1752619670829.png","stremtv-us:TVLandDrama.us":"https://images.pluto.tv/channels/5d40bebc5e3d2750a2239d7e/colorLogoPNG.png","stremtv-us:WeedsNurseJackie.us":"https://images.pluto.tv/channels/688a44cf5d73ec0a3f49718b/colorLogoPNG.png","stremtv-us:ForeverKids.us":"https://images.pluto.tv/channels/56171fafada51f8004c4b40f/colorLogoPNG.png","stremtv-us:Tosh0.us":"https://images.pluto.tv/channels/65e977042873090008b48be9/colorLogoPNG.png","stremtv-us:PlutoTVESports.us":"https://images.pluto.tv/channels/5ff3934600d4c7000733ff49/colorLogoPNG.png","stremtv-us:SensingMurder.us":"https://images.pluto.tv/channels/5e9ed47c26ebb000074af566/colorLogoPNG.png","stremtv-us:PlutoTVSeriesdeCrimen.us":"https://images.pluto.tv/channels/655f62ff954b020008c91ec6/colorLogoPNG.png","stremtv-us:ProntosocorroHistoriasDeEmergencia.us":"https://images.pluto.tv/channels/61bb72a7bf8c520007a8fd27/colorLogoPNG.png","stremtv-us:Bonanza.us":"https://images.pluto.tv/channels/696e647b07ea70192d49f6a5/colorLogoPNG.png","stremtv-us:Daria.us":"https://images.pluto.tv/channels/62d0895ebe7a970008785244/colorLogoPNG.png","stremtv-us:PerryMason.us":"https://images.pluto.tv/channels/63e20bd160bc8f0008b4c949/colorLogoPNG.png","stremtv-us:DossiersFBI.us":"https://images.pluto.tv/channels/5f8edad922b10b000753bc37/colorLogoPNG.png","stremtv-us:AmericasVoiceNews.us":"https://images.pluto.tv/channels/5e1f7da4bc7d740009831259/colorLogoPNG.png","stremtv-us:LasTortugasNinja.us":"https://images.pluto.tv/channels/63dd5d7a4e83e700088fbca8/colorLogoPNG.png","stremtv-us:Numeros.us":"https://images.pluto.tv/channels/67f960680072d6b187a0682e/colorLogoPNG.png","stremtv-us:PlutoTVNovelasdeOtrosContinentes.us":"https://images.pluto.tv/channels/686eed4c677f2f98b4a1ccd4/colorLogoPNG.png","stremtv-us:PlutoTVKids.us":"https://images.pluto.tv/channels/5dd6dae8ce788b0009eaf77b/colorLogoPNG.png","stremtv-us:CarChase.us":"https://images.pluto.tv/channels/65a93b0607e03a000895abda/colorLogoPNG.png","stremtv-us:m3u-us-VH1":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/vh1-us.png","stremtv-us:ComedyCentralSouthPark.us":"https://images.pluto.tv/channels/609ae5cd48d3200007b0a98e/colorLogoPNG.png","stremtv-us:NarutoShippuden.us":"https://images.pluto.tv/channels/64c92fea3c3344000869e8a9/colorLogoPNG.png","stremtv-us:48Hours.us":"https://images.pluto.tv/channels/6346937a46f9a2000889073d/colorLogoPNG.png","stremtv-us:SouthParkColecaoCartman.us":"https://images.pluto.tv/channels/65df71008b24c80008f04281/colorLogoPNG.png","stremtv-us:HSN.us":"https://images.pluto.tv/channels/5f8a02476b72230007e62b7d/colorLogoPNG_1779087603120.png","stremtv-us:MTVRocks.us":"https://images.pluto.tv/channels/66a01b52a4ee27000808ea36/colorLogoPNG.png","stremtv-us:MoreTVSitcoms.us":"https://images.pluto.tv/channels/6132619f9ddaa50007e7dd86/colorLogoPNG.png","stremtv-us:MissionImpossible.us":"https://images.pluto.tv/channels/6478a9e4f77b61000817034b/colorLogoPNG.png","stremtv-us:PlutoTVKFOOD.us":"https://images.pluto.tv/channels/633ee9ba83c08f00076b60a6/colorLogoPNG.png","stremtv-us:HotBench.us":"https://images.pluto.tv/channels/6036e6e7ac69c400072afca2/colorLogoPNG_1731835667408.png","stremtv-us:Lemiracledelamour.us":"https://images.pluto.tv/channels/60549c238c3f21000753d3e0/colorLogoPNG.png","stremtv-us:PlutoTVCineEstelar.us":"https://images.pluto.tv/channels/5dcde437229eff00091b6c30/colorLogoPNG.png","stremtv-us:PlutoTVNaturaleza.us":"https://images.pluto.tv/channels/5dd85eac039bba0009e86d1d/colorLogoPNG.png","stremtv-us:NickJrPlutoTV.us":"https://images.pluto.tv/channels/62bdb75c3afd1200079146a6/colorLogoPNG.png","stremtv-us:VevoTrueSchoolHipHop.us":"https://images.pluto.tv/channels/61d4c2817a823d00070ba53e/colorLogoPNG.png","stremtv-us:TheRifleman.us":"https://images.pluto.tv/channels/5e825550e758c700077b0aef/colorLogoPNG.png","stremtv-us:SpikePlutoTV.us":"https://images.pluto.tv/channels/5812bcc8237a6ff45d16c407/colorLogoPNG.png","stremtv-us:IlBancodeiPugni.us":"https://images.pluto.tv/channels/60e4507a06171800072339a3/colorLogoPNG.png","stremtv-us:LesorelleMcLeod.us":"https://images.pluto.tv/channels/60a2837f8154ab0007c4dcdf/colorLogoPNG.png","stremtv-us:PlutoTVDesenhosClassicos.us":"https://images.pluto.tv/channels/655e5c4d2c46f3000877a54b/colorLogoPNG.png","stremtv-us:OEncantadordeCaes.us":"https://images.pluto.tv/channels/61099df8cee03b00074b2ecf/colorLogoPNG.png","stremtv-us:PlutoTVPeleas.us":"https://images.pluto.tv/channels/5e98b0447665f200078caded/colorLogoPNG.png","stremtv-us:StarzComedy.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/starz-comedy-us.png","stremtv-us:Enelpuntodemira.us":"https://images.pluto.tv/channels/61922be835f3910007fc58f6/colorLogoPNG.png","stremtv-us:PlutoTVCineCrimen.us":"https://images.pluto.tv/channels/624af40c004f8000079b784d/colorLogoPNG.png","stremtv-us:Crunchyroll.us":"https://images.pluto.tv/channels/65652f7fc0fc88000883537a/colorLogoPNG.png","stremtv-us:PlutoTVKidsClub.us":"https://images.pluto.tv/channels/66c8cae7fed35b0008580ec0/colorLogoPNG.png","stremtv-us:MTVTeenMom.us":"https://images.pluto.tv/channels/61c092157e1b8b0007372a35/colorLogoPNG.png","stremtv-us:PlutoTVCineClassicos.us":"https://images.pluto.tv/channels/5fa1612a669ba0000702017b/colorLogoPNG.png","stremtv-us:VH1QueensofReality.us":"https://images.pluto.tv/channels/66abefe5d2d50d00082c7d12/colorLogoPNG.png","stremtv-us:PlutoTVFiccaoCientifica.us":"https://images.pluto.tv/channels/5fa15ad6367e170007cdd098/colorLogoPNG.png","stremtv-us:PlutoTVReality.us":"https://images.pluto.tv/channels/67922858b83355184c699699/colorLogoPNG.png","stremtv-us:ToughJobs.us":"https://images.pluto.tv/channels/65c69bf23ef47d0008583967/colorLogoPNG.png","stremtv-us:Investiga.us":"https://images.pluto.tv/channels/5dcde27ffae9520009c0c75a/colorLogoPNG.png","stremtv-us:Nashville.us":"https://images.pluto.tv/channels/65cf8d7428730900087c5907/colorLogoPNG.png","stremtv-us:90sKids.us":"https://images.pluto.tv/channels/6452c814939a590008567a3b/colorLogoPNG_1731836283044.png","stremtv-us:50CentAction.us":"https://images.pluto.tv/channels/68487fb3f212bedacf5a53e3/colorLogoPNG_1749846553889.png","stremtv-us:BETCinema.us":"https://images.pluto.tv/channels/58af4c093a41ca9d4ecabe96/colorLogoPNG_1759338280891.png","stremtv-us:PlutoTVInvestigacao.us":"https://images.pluto.tv/channels/5f32cf37c9ff2b00082adbc8/colorLogoPNG.png","stremtv-us:JAG.us":"https://images.pluto.tv/channels/654a4ab92c1d330008657ae5/colorLogoPNG.png","stremtv-us:SouthParkWelcometoCanada.us":"https://images.pluto.tv/channels/663115d923e24f000843b49c/colorLogoPNG.png","stremtv-us:FunnyAF.us":"https://images.pluto.tv/channels/65a6a5e90c7ff50008cb9815/colorLogoPNG.png","stremtv-us:PlutoTVTrendingNow.us":"https://images.pluto.tv/channels/673247127d5da5000817b4d6/colorLogoPNG_1732662634386.png","stremtv-us:PlutoTVCompetencias.us":"https://images.pluto.tv/channels/5dd6d935d000120009bc1132/colorLogoPNG.png","stremtv-us:ClassicTVDrama.us":"https://images.pluto.tv/channels/5f15e3cccf49290007053c67/colorLogoPNG.png","stremtv-us:ElComisario.us":"https://images.pluto.tv/channels/60c343007bcabe0007242aa6/colorLogoPNG.png","stremtv-us:ArchivosForenses.us":"https://images.pluto.tv/channels/5efb8c19b2678b000780d032/colorLogoPNG.png","stremtv-us:IcePilots.us":"https://images.pluto.tv/channels/62cd97fb9f8154000727516c/colorLogoPNG.png","stremtv-us:PlutoTVClassicTVVariety.us":"https://images.pluto.tv/channels/68d25c623175a2780d051d3a/colorLogoPNG.png","stremtv-us:PlutoTVDramasCoreanosTeen.us":"https://images.pluto.tv/channels/6661d5424b10960008599fa3/colorLogoPNG.png","stremtv-us:NCISLosAngeles.us":"https://images.pluto.tv/channels/66fbf4d3d7de140008d41f5b/colorLogoPNG.png","stremtv-us:PlutoTVDogelcazarrecompensas.us":"https://images.pluto.tv/channels/5f9992c685a2a80007fa414a/colorLogoPNG.png","stremtv-us:MTVReality.us":"https://images.pluto.tv/channels/685137f4a1e091e16f2dd471/colorLogoPNG.png","stremtv-us:BobEsponjaCalcaQuadrada.us":"https://images.pluto.tv/channels/62545c0b002f4b0007688b61/colorLogoPNG.png","stremtv-us:Cineaventura.us":"https://images.pluto.tv/channels/60fb2f47c133270007327375/colorLogoPNG_1757954279063.png","stremtv-us:KenanKel.us":"https://images.pluto.tv/channels/5ffcc5130fd98c0007f2e216/colorLogoPNG.png","stremtv-us:PlutoTVAnime.us":"https://images.pluto.tv/channels/68d25b620a0f3829b116bb6f/colorLogoPNG.png","stremtv-us:TheLoveBoat.us":"https://images.pluto.tv/channels/5f7794a788d29000079d2f07/colorLogoPNG_1731835231895.png","stremtv-us:OnTheCase.us":"https://images.pluto.tv/channels/62cd971cec90c20007081050/colorLogoPNG.png","stremtv-us:MTVAreyoutheOne.us":"https://images.pluto.tv/channels/5f6108d8cc331900075e98e4/colorLogoPNG.png","stremtv-us:ClassicTVFamilies.us":"https://images.pluto.tv/channels/62e91af00c43540007f2bb43/colorLogoPNG.png","stremtv-us:TastemadeBrasil.us":"https://images.pluto.tv/channels/5f998c1fc54853000797bacd/colorLogoPNG.png","stremtv-us:Degrassi.us":"https://images.pluto.tv/channels/62bdaf3470f09a000714a2f6/colorLogoPNG.png","stremtv-us:SouthParkColecaoKyle.us":"https://images.pluto.tv/channels/65df713dec9fda0008b7a81d/colorLogoPNG.png","stremtv-us:TeenMom.us":"https://images.pluto.tv/channels/62e7fc8c0d061100083946a9/colorLogoPNG.png","stremtv-us:PlutoTVHistoriasdeUltratumba.us":"https://images.pluto.tv/channels/5f4d3696d938c900072679fd/colorLogoPNG.png","stremtv-us:PlutoTVSeriesdeComedia.us":"https://images.pluto.tv/channels/655f626d57fe4a00085c7c3e/colorLogoPNG.png","stremtv-us:LesAnneesfac.us":"https://images.pluto.tv/channels/60afae68a7fc50000737186d/colorLogoPNG.png","stremtv-us:BigBrother.us":"https://images.pluto.tv/channels/6661f11a41af6400080e90d8/colorLogoPNG.png","stremtv-us:WesternTV.us":"https://images.pluto.tv/channels/5e8df4bc16e34700077e77d3/colorLogoPNG.png","stremtv-us:SouthParkStanCollection.us":"https://images.pluto.tv/channels/65d879e266eec8000887e91b/colorLogoPNG.png","stremtv-us:LosAsesinatosdeMidsomer.us":"https://images.pluto.tv/channels/6764203df433320008836bc6/colorLogoPNG.png","stremtv-us:PlutoTVLosnuevosdetectives.us":"https://images.pluto.tv/channels/5f1acba0d1f6340007db8843/colorLogoPNG.png","stremtv-us:MTVShore.us":"https://images.pluto.tv/channels/625463563b8ddc0007134aeb/colorLogoPNG.png","stremtv-us:Yaquelaveritequicompte.us":"https://images.pluto.tv/channels/612e044c970e6f00083bcf3b/colorLogoPNG.png","stremtv-us:Tokusato.us":"https://images.pluto.tv/channels/5ff608e60e2996000768c366/colorLogoPNG.png","stremtv-us:PlutoTVParanormal.us":"https://images.pluto.tv/channels/62b30beb81f89900071fc7b9/colorLogoPNG.png","stremtv-us:Frasier.us":"https://images.pluto.tv/channels/6400c095498393000878a634/colorLogoPNG.png","stremtv-us:PlutoTVShowsporStingray.us":"https://images.pluto.tv/channels/604b91e0692f770007d9f33f/colorLogoPNG.png","stremtv-us:TheChallenge.us":"https://images.pluto.tv/channels/64f8a22a3efb510008245df0/colorLogoPNG.png","stremtv-us:PlutoTVNovelas.us":"https://images.pluto.tv/channels/5dcde0cc2efd2700090b7ff4/colorLogoPNG.png","stremtv-us:DetetivesMedicos.us":"https://images.pluto.tv/channels/638df93ae2f2a3000737c168/colorLogoPNG.png","stremtv-us:FilmesSuspense.us":"https://images.pluto.tv/channels/5f171d3442a0500007362f22/colorLogoPNG.png","stremtv-us:PlutoTVVidaReal.us":"https://images.pluto.tv/channels/5df265697ec3510009df1ef0/colorLogoPNG.png","stremtv-us:Rawhide.us":"https://images.pluto.tv/channels/6964ba787e92438c2754e924/colorLogoPNG.png","stremtv-us:ZNation.us":"https://images.pluto.tv/channels/66b3af1c3a4ad200081c7d03/colorLogoPNG.png","stremtv-us:MTVSpankinNew.us":"https://images.pluto.tv/channels/6541010f770cf1000866be98/colorLogoPNG.png","stremtv-us:MasterChef.us":"https://images.pluto.tv/channels/6077045b6031bd00078de127/colorLogoPNG.png","stremtv-us:TheNanny.us":"https://images.pluto.tv/channels/6391cef9edb23c0008598cee/colorLogoPNG.png","stremtv-us:SupernaturalDrama.us":"https://images.pluto.tv/channels/5f24662bebe0f0000767de32/colorLogoPNG.png","stremtv-us:ShopLC.us":"https://images.pluto.tv/channels/68ee9a999938143525bfc385/colorLogoPNG_1760999630595.png","stremtv-us:PlutoTVSeriesdeDrama.us":"https://images.pluto.tv/channels/655f636d954b020008c93299/colorLogoPNG.png","stremtv-us:PlutoTVElReinoInfantil.us":"https://images.pluto.tv/channels/5f4d3d06fb60d8000781fce8/colorLogoPNG.png","stremtv-us:CinePremiere.us":"https://images.pluto.tv/channels/5cf968040ab7d8f181e6a68b/colorLogoPNG.png","stremtv-us:BobEsponjaPantalonesCuadrados.us":"https://images.pluto.tv/channels/6254598f5083f800076d8563/colorLogoPNG.png","stremtv-us:PlutoTVLives.us":"https://images.pluto.tv/channels/5d8beeb39b5d5d5f8c672530/colorLogoPNG.png","stremtv-us:5Cops.us":"https://images.pluto.tv/channels/5d2c571faeb3e2738ae27933/colorLogoPNG.png","stremtv-us:Nosey.us":"https://images.pluto.tv/channels/619e1ef4f42ad90007e00a21/colorLogoPNG.png","stremtv-us:CSIMiamienespanol.us":"https://images.pluto.tv/channels/632b5950b515b000079e6b81/colorLogoPNG_1731837336190.png","stremtv-us:SouthParkEnFrancais.us":"https://images.pluto.tv/channels/62bdb919d36cbd0007e6ab8a/colorLogoPNG.png","stremtv-us:TheWalkingDeadenEspanol.us":"https://images.pluto.tv/channels/5e82bb378601b80007b4bd78/colorLogoPNG.png","stremtv-us:TotallyTurtles.us":"https://images.pluto.tv/channels/61c0bbd95df1da0007bed5a0/colorLogoPNG.png","stremtv-us:PlutoTVRetroActionMovies.us":"https://images.pluto.tv/channels/69a9ae4d3bd16a4ed04240d7/colorLogoPNG.png","stremtv-us:Moviedome.us":"https://images.pluto.tv/channels/615c1e5ce3039400070a0547/colorLogoPNG.png","stremtv-us:PlutoTVSeriesCriminais.us":"https://images.pluto.tv/channels/6474ab5cdc7a760008745008/colorLogoPNG.png","stremtv-us:PlutoTVMelrosePlace.us":"https://images.pluto.tv/channels/62a0ae0e4e47a30007fe21bb/colorLogoPNG.png","stremtv-us:Narutoenespanol.us":"https://images.pluto.tv/channels/5ee92e72fb286e0007285fec/colorLogoPNG.png","stremtv-us:LouisLaBrocante.us":"https://images.pluto.tv/channels/5f8ed6d569d2d4000864a976/colorLogoPNG.png","stremtv-us:PlutoTVRetroCrimeAction.us":"https://images.pluto.tv/channels/69aee8a1acb7eb0bb68df641/colorLogoPNG.png","stremtv-us:PlutoTVAventura.us":"https://images.pluto.tv/channels/5ddc266f80e3550009136843/colorLogoPNG.png","stremtv-us:PlutoTVSeriesdeSciFi.us":"https://images.pluto.tv/channels/65662f8a2c46f300088a84cc/colorLogoPNG.png","stremtv-us:IronChef.us":"https://images.pluto.tv/channels/682b385876963fba9abf0f26/colorLogoPNG.png","stremtv-us:CSI.us":"https://images.pluto.tv/channels/6525419dc52b3600083db9c3/colorLogoPNG.png","stremtv-us:HogansHeroes.us":"https://images.pluto.tv/channels/6a56adb02f9e0117d78f5b44/colorLogoPNG.png","stremtv-us:PlutoTVAmoryMentiras.us":"https://images.pluto.tv/channels/698a45156dc3c71eb1ba6599/colorLogoPNG.png","stremtv-us:TortuesNinjaTV.us":"https://images.pluto.tv/channels/62e9566e27ce19000732ec85/colorLogoPNG.png","stremtv-us:StarTrek.us":"https://images.pluto.tv/channels/61c1979dfa307000070bbe4d/colorLogoPNG.png","stremtv-us:MarriedwithChildren.us":"https://images.pluto.tv/channels/66bb3212fe11e5000883ea6b/colorLogoPNG.png","stremtv-us:Lesfillesdacote.us":"https://images.pluto.tv/channels/60549d97cd7b090007c73314/colorLogoPNG.png","stremtv-us:PlutoTVPokemon.us":"https://images.pluto.tv/channels/66ebf4a88131f10008b74739/colorLogoPNG.png","stremtv-us:PlutoTVCineDrama.us":"https://images.pluto.tv/channels/5dcddfcb229eff00091b6bdf/colorLogoPNG.png","stremtv-us:ChaosCity.us":"https://images.pluto.tv/channels/60afbad343e3840007164348/colorLogoPNG.png","stremtv-us:ComedyCentralPlutoTV.us":"https://images.pluto.tv/channels/61c0989431084d0007eab12d/colorLogoPNG.png","stremtv-us:Gunsmoke.us":"https://images.pluto.tv/channels/60f75771dfc72a00071fd0e0/colorLogoPNG.png","stremtv-us:PlutoTVEstrellasdeAccion.us":"https://images.pluto.tv/channels/5e972a21ad709d00074195ba/colorLogoPNG.png","stremtv-us:PlutoTVHometownDrama.us":"https://images.pluto.tv/channels/69d6c7befde57cd5ba0160c3/colorLogoPNG_1777488284970.png","stremtv-us:CineAmor.us":"https://images.pluto.tv/channels/5f5136317aedfb0007016f93/colorLogoPNG_1757957531383.png","stremtv-us:PlutoTVNovelasdeMexico.us":"https://images.pluto.tv/channels/6474a7958e3c0a0008b97cae/colorLogoPNG.png","stremtv-us:SouthParkColeccionKenny.us":"https://images.pluto.tv/channels/65df7272ec9fda0008b7a970/colorLogoPNG.png","stremtv-us:SouthParkColecaoStan.us":"https://images.pluto.tv/channels/65df70b0f7f0af0008c3b316/colorLogoPNG.png","stremtv-us:AvatarLaLeyendadeAang.us":"https://images.pluto.tv/channels/6759ee82bd523200083b4f0f/colorLogoPNG.png","stremtv-us:PlutoTVNuestroCine.us":"https://images.pluto.tv/channels/5defde6d6c07b50009cf0757/colorLogoPNG.png","stremtv-us:LiveMusic.us":"https://images.pluto.tv/channels/5873fc21cad696fb37aa9054/colorLogoPNG.png","stremtv-us:PlutoTVEsportes.us":"https://images.pluto.tv/channels/5f32d2db0af67400077f29c4/colorLogoPNG.png","stremtv-us:PlutoTVAdventure.us":"https://images.pluto.tv/channels/653bdb0fbdf3cf00089cc395/colorLogoPNG.png","stremtv-us:HLN.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/hln-us.png","stremtv-us:InkMaster.us":"https://images.pluto.tv/channels/655f2d713944b60008bc7e90/colorLogoPNG.png","stremtv-us:TheWildWildWest.us":"https://images.pluto.tv/channels/6964bc3806d76f50db3e315e/colorLogoPNG.png","stremtv-us:ClassicMoviesChannel.us":"https://images.pluto.tv/channels/561c5b0dada51f8004c4d855/colorLogoPNG_1759790242932.png","stremtv-us:PlutoTVCineRomance.us":"https://images.pluto.tv/channels/5dd7ea2aeab5230009986735/colorLogoPNG.png","stremtv-us:ClassicTVComedy.us":"https://images.pluto.tv/channels/6a56ae15bd858f210ae007fe/colorLogoPNG.png","stremtv-us:PlutoTVPaisagensporStingray.us":"https://images.pluto.tv/channels/604a8dedbca75b0007b1c753/colorLogoPNG.png","stremtv-us:GarfieldandFriends.us":"https://images.pluto.tv/channels/677f927554f43dad4b3258aa/colorLogoPNG.png","stremtv-us:FamilyTies.us":"https://images.pluto.tv/channels/654a4a3ef91d250008ac089b/colorLogoPNG.png","stremtv-us:PlutoTVTheTwilightZone.us":"https://images.pluto.tv/channels/6512ec9f3a0d700008db4f0c/colorLogoPNG.png","stremtv-us:LesNouveauxDetectives.us":"https://images.pluto.tv/channels/5f8edb6df1ebb800072edf10/colorLogoPNG.png","stremtv-us:TheAndyGriffithShow.us":"https://images.pluto.tv/channels/62e9145ec07f2a00070e68dc/colorLogoPNG.png","stremtv-us:MTVJovenseMaes.us":"https://images.pluto.tv/channels/620fdc7d8a36fc000710e3ba/colorLogoPNG.png","stremtv-us:TurmadaMonica.us":"https://images.pluto.tv/channels/5f997e44949bc70007a6941e/colorLogoPNG.png","stremtv-us:Revry.us":"https://images.pluto.tv/channels/674f735a2fb8a100087bf253/colorLogoPNG_1748892659343.png","stremtv-us:ClassicTVCrimeDrama.us":"https://images.pluto.tv/channels/61325c4f982acd000723287e/colorLogoPNG.png","stremtv-us:NickJrClub.us":"https://images.pluto.tv/channels/5ddd7cb2cbb9010009b4fe32/colorLogoPNG.png","stremtv-us:HBO.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/hbo-us.png","stremtv-us:PlutoTVNetmovies.us":"https://images.pluto.tv/channels/663b9de4f999220008230fa8/colorLogoPNG.png","stremtv-us:StarTrekTheNextGeneration.us":"https://images.pluto.tv/channels/6a42707f7dd69d931963b5d4/colorLogoPNG.png","stremtv-us:Empenosalobestia.us":"https://images.pluto.tv/channels/5f23102d5e239d00074b092a/colorLogoPNG.png","stremtv-us:PlutoTVDeportes.us":"https://images.pluto.tv/channels/5dcde07af1c85b0009b18651/colorLogoPNG.png","stremtv-us:DiscoveryFamily.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/discovery-family-us.png","stremtv-us:MTVJerseyShore.us":"https://images.pluto.tv/channels/68b9b0dbf9cf3d7cb9f56d88/colorLogoPNG.png","stremtv-us:PlutoTVStorageWars.us":"https://images.pluto.tv/channels/6887aaf4e3703b7d42b71a1e/colorLogoPNG_1784129527094.png","stremtv-us:Anaylos7.us":"https://images.pluto.tv/channels/5f1acce7f17797000718f9be/colorLogoPNG.png","stremtv-us:PlutoTVTerrorTrash.us":"https://images.pluto.tv/channels/66aa67493a4ad2000806d91b/colorLogoPNG.png","stremtv-us:MTVRidiculousness.us":"https://images.pluto.tv/channels/62cd9641393d8400076f34db/colorLogoPNG.png","stremtv-us:OnePiece.us":"https://images.pluto.tv/channels/62e94ec74823db0007277a8f/colorLogoPNG.png","stremtv-us:HappyDays.us":"https://images.pluto.tv/channels/654a4e29ab05240008a18625/colorLogoPNG.png","stremtv-us:PlutoTVCineInspiracao.us":"https://images.pluto.tv/channels/5fa991b1f09e020007e78626/colorLogoPNG.png","stremtv-us:BETVisionaries.us":"https://images.pluto.tv/channels/663946c1b18d700008d9c168/colorLogoPNG_1759338795452.png","stremtv-us:CSIMiami.us":"https://images.pluto.tv/channels/63eb9255c111bc0008fe6ec4/colorLogoPNG.png","stremtv-us:Matlock.us":"https://images.pluto.tv/channels/66290a779e68c20008a18cf3/colorLogoPNG.png","stremtv-us:NickelodeonTeen.us":"https://images.pluto.tv/channels/5fab09a8749b1a00077d35d2/colorLogoPNG.png","stremtv-us:FeelGoodDrama.us":"https://images.pluto.tv/channels/65775af3b3801200084a3aa4/colorLogoPNG.png","stremtv-us:StarTrekDeepSpaceNine.us":"https://images.pluto.tv/channels/6a426e053a96e5056db52261/colorLogoPNG.png","stremtv-us:Sintetasnohayparaiso.us":"https://images.pluto.tv/channels/604bdf4e6d0abc0007ba77ad/colorLogoPNG.png","stremtv-us:PlutoTVMisteriosMedicos.us":"https://images.pluto.tv/channels/5f230e416b68ff00075b0139/colorLogoPNG.png","stremtv-us:PlutoTVSciFi.us":"https://images.pluto.tv/channels/61f9598588f86000078ee7d6/colorLogoPNG.png","stremtv-us:PlutoTVSeriesComedia.us":"https://images.pluto.tv/channels/655e5bc94261ca000810cb17/colorLogoPNG.png","stremtv-us:PlutoTVCineSucessos.us":"https://images.pluto.tv/channels/5f120e94a5714d00074576a1/colorLogoPNG.png","stremtv-us:PlutoTVRecordNews.us":"https://images.pluto.tv/channels/6102e04e9ab1db0007a980a1/colorLogoPNG.png","stremtv-us:InazumaEleven.us":"https://images.pluto.tv/channels/612375086abc84000738fc03/colorLogoPNG.png","stremtv-us:TVLandSitcoms.us":"https://images.pluto.tv/channels/5c2d64ffbdf11b71587184b8/colorLogoPNG.png","stremtv-us:HGTV.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/hgtv-us.png","stremtv-us:ILoveLucy.us":"https://images.pluto.tv/channels/63a2f1dda0d69700078b7cba/colorLogoPNG.png","stremtv-us:Bobleponge.us":"https://images.pluto.tv/channels/66588931a3865300085ca800/colorLogoPNG.png","stremtv-us:Rugrats.us":"https://images.pluto.tv/channels/5ea7215005d66d0007e8128a/colorLogoPNG.png","stremtv-us:PlutoTVJunior.us":"https://images.pluto.tv/channels/5dcde2ac4bc6c500094ab45b/colorLogoPNG.png","stremtv-us:90sKidsTV2.us":"https://images.pluto.tv/channels/6452c77ed3fdde00080eb3a8/colorLogoPNG.png","stremtv-us:AmericasNextTopModel.us":"https://images.pluto.tv/channels/6464cc595a0cd500088c7749/colorLogoPNG.png","stremtv-us:PlutoTVIcons.us":"https://images.pluto.tv/channels/64b585f84ea480000838e446/colorLogoPNG_1785343035531.png","stremtv-us:BETThrowbacks.us":"https://images.pluto.tv/channels/61326275b3c86a00078e4833/colorLogoPNG_1759340015358.png","stremtv-us:Ridiculousness.us":"https://images.pluto.tv/channels/5f8eb8a8b2619a000710605c/colorLogoPNG.png","stremtv-us:MonsterJam.us":"https://images.pluto.tv/channels/65c33fd4dc10a40008f26af8/colorLogoPNG.png","stremtv-us:PBRRidePass.us":"https://images.pluto.tv/channels/60d39387706fe50007fda8e8/colorLogoPNG.png","stremtv-us:MTVComoEx.us":"https://images.pluto.tv/channels/61a528267e1b8b0007357920/colorLogoPNG.png","stremtv-us:PlutoTVNatureza.us":"https://images.pluto.tv/channels/5f1213ba0ecebc00070e170f/colorLogoPNG.png","stremtv-us:Unidaddeinvestigacion.us":"https://images.pluto.tv/channels/61bb2814ac085a00074309a6/colorLogoPNG.png","stremtv-us:JerseyShore.us":"https://images.pluto.tv/channels/6442508e5a0cd500083edd3c/colorLogoPNG.png","stremtv-us:PlutoTVAnimeMovies.us":"https://images.pluto.tv/channels/67ed8f7e443f0671bc2b2368/colorLogoPNG_1747069531459.png","stremtv-us:BritishComedy.us":"https://images.pluto.tv/channels/638e11951177840007fdd6b2/colorLogoPNG.png","stremtv-us:YoMTV.us":"https://images.pluto.tv/channels/654102ed770cf1000866c307/colorLogoPNG.png","stremtv-us:ComedyCentral.us":"https://images.pluto.tv/channels/64f8a408bd341e000818fcda/colorLogoPNG.png","stremtv-us:PlutoTVDocumentales.us":"https://images.pluto.tv/channels/5ddc503ac7ef120009b101a2/colorLogoPNG.png","stremtv-us:PlutoTVNegocioFechado.us":"https://images.pluto.tv/channels/64ad7394798def00087b2bfe/colorLogoPNG.png","stremtv-us:MacGyver.us":"https://images.pluto.tv/channels/654a59742c1d33000865a797/colorLogoPNG.png","stremtv-us:PlutoTVFilmesAcao.us":"https://images.pluto.tv/channels/5f120f41b7d403000783a6d6/colorLogoPNG.png","stremtv-us:PlutoTVGameShows.us":"https://images.pluto.tv/channels/6036e7c385749f00075dbd3b/colorLogoPNG.png","stremtv-us:OReinoInfantil.us":"https://images.pluto.tv/channels/5f5c216df68f920007888315/colorLogoPNG.png","stremtv-us:TheBeverlyHillbillies.us":"https://images.pluto.tv/channels/6565fefdc917a50008485cc6/colorLogoPNG.png","stremtv-us:GhostDimension.us":"https://images.pluto.tv/channels/619e1bb3e9af5a0007f235ad/colorLogoPNG.png","stremtv-us:BETPlutoTV.us":"https://images.pluto.tv/channels/5ff768b6a4c8b80008498610/colorLogoPNG.png","stremtv-us:PlutoTVSeriesSciFi.us":"https://images.pluto.tv/channels/63d2ba2f60bc8f0008981a0e/colorLogoPNG.png","stremtv-us:AvatarAlendadeAang.us":"https://images.pluto.tv/channels/6759eeb1bd523200083b4f29/colorLogoPNG.png","stremtv-us:TheAddamsFamily.us":"https://images.pluto.tv/channels/5d81607ab737153ea3c1c80e/colorLogoPNG.png","stremtv-us:CBSenespanol.us":"https://images.pluto.tv/channels/668c5cb4f01dbe0008dd4082/colorLogoPNG.png","stremtv-us:PlutoTVSeriesRetro.us":"https://images.pluto.tv/channels/5de802659167b10009e7deba/colorLogoPNG.png","stremtv-us:Bounce.us":"https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/public/logos/usa/bounce-us.png"};
// W121ZEPG178G: Exact-ID brand artwork fallback; not claimed to be distinct subfeed logos.
const w178gBrandFallbacks: Readonly<Record<string,string>> = {"stremtv-us:DareToDreamNetwork.us":"https://i.imgur.com/16DMxP4.png","stremtv-us:3ABNInternational.us":"https://i.imgur.com/16DMxP4.png","stremtv-us:3ABNKids.us":"https://i.imgur.com/16DMxP4.png","stremtv-us:3ABNProclaimNetwork.us":"https://i.imgur.com/16DMxP4.png","a-e-live-pd-greatest-shifts":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/A%26E_Network_logo.svg/960px-A%26E_Network_logo.svg.png","a-e-s-alaska-state-troopers":"https://upload.wikimedia.org/wikipedia/commons/thumb/d/df/A%26E_Network_logo.svg/960px-A%26E_Network_logo.svg.png","american-pickers-plus-by-history":"https://images.pluto.tv/channels/6408ae8f9b39550008caf94f/colorLogoPNG.png","stremtv-us:AmericasVoice.us":"https://images.pluto.tv/channels/5e1f7da4bc7d740009831259/colorLogoPNG.png"};
const w172dLogoFor = (channel: GuideChannel): string => {
  const w178gId = String(channel.item?.id || channel.item?.imdb_id || '').trim();
  const w178gBrand = w178gBrandFallbacks[w178gId];
  if (w178gBrand) return w178gBrand;
  const w178eId = String(channel.item?.id || channel.item?.imdb_id || '').trim();
  const w178eUrl = w178eExactVerifiedImageResponses[w178eId];
  if (w178eUrl && String(channel.addonId || '').trim() === 'com.stremtv.us') return w178eUrl;
  const w177vId = String(channel.item?.id || channel.item?.imdb_id || '').trim();
  const w177vExact = w177vVerifiedLogos[w177vId] || w177vVerifiedLogos[`${String(channel.addonId || '').trim()}:${w177vId}`];
  if (w177vExact) return w177vExact;
  if (String(channel.addonId || '').trim() === 'com.stremtv.us') {
    const id = String(channel.item?.id || channel.item?.imdb_id || '').trim();
    // Preserve the eight manually confirmed 3ABN logo identities.
    if (w174bProtectedStremTvIds.has(id)) {
      // Prefer the provider's explicit HTTPS artwork; retain the previously
      // resolved logo if no valid provider artwork is available.
      const providerLogo = String((channel.item as any)?.logo || '').trim();
      if (/^https:\/\//i.test(providerLogo)) return providerLogo;
      return String(channel.logo || '');
    }
    // Provider-owned explicit logos, where present, remain authoritative.
    const explicit = String((channel.item as any)?.logo || '').trim();
    if (/^https:\/\//i.test(explicit)) return explicit;
    const exact = w174bStremTvExactLogos[id];
    if (exact) return exact;
  }
  const brand = String(channel.name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return w172dBrandLogos[brand] || String(channel.logo || '');
};

type V789gCategoryKey =
  | 'favorites'
  | 'us'
  | 'news'
  | 'sports'
  | 'movies'
  | 'entertainment'
  | 'kids'
  | 'crime'
  | 'reality'
  | 'comedy'
  | 'lifestyle'
  | 'documentary'
  | 'music'
  | 'anime'
  | 'spanish'
  | 'portuguese'
  | 'german'
  | 'french'
  | 'italian'
  | 'danish'
  | 'swedish'
  | 'norwegian'
  | 'finnish'
  | 'uk'
  | 'canada'
  | 'weather'
  | 'all';

type V789gCategoryDef = {
  key: V789gCategoryKey;
  label: string;
};

const V789G_CHANNEL_META: any =
  require('../../src/data/liveTvChannelMeta.json');

const V789G_CATEGORY_DEFS: V789gCategoryDef[] = [
  { key: 'favorites', label: 'Favorites' },
  { key: 'us', label: 'US Channels' },
  { key: 'news', label: 'News' },
  { key: 'sports', label: 'Sports' },
  { key: 'movies', label: 'Movies' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'kids', label: 'Kids' },
  { key: 'crime', label: 'Crime' },
  { key: 'reality', label: 'Reality' },
  { key: 'comedy', label: 'Comedy' },
  { key: 'lifestyle', label: 'Lifestyle' },
  { key: 'documentary', label: 'Documentary' },
  { key: 'music', label: 'Music' },
  { key: 'anime', label: 'Anime' },
  { key: 'spanish', label: 'Spanish' },
  { key: 'portuguese', label: 'Portuguese' },
  { key: 'german', label: 'German' },
  { key: 'french', label: 'French' },
  { key: 'italian', label: 'Italian' },
  { key: 'danish', label: 'Danish' },
  { key: 'swedish', label: 'Swedish' },
  { key: 'norwegian', label: 'Norwegian' },
  { key: 'finnish', label: 'Finnish' },
  { key: 'uk', label: 'UK Channels' },
  { key: 'canada', label: 'Canadian Channels' },
  { key: 'weather', label: 'Weather' },
  { key: 'all', label: 'All Channels' },
];

const V789G_SPANISH_REGIONS =
  new Set([
    'es',
    'mx',
    'ar',
    'co',
    'cr',
    'pe',
    've',
    'cl',
    'bo',
    'sv',
    'gt',
    'hn',
    'ni',
    'pa',
    'uy',
    'ec',
    'py',
    'do',
  ]);

const v789gNormalize = (value: any) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

const v789gFavoriteId = (
  channel: GuideChannel
) =>
  String(
    channel.item.imdb_id ||
      channel.item.id ||
      ''
  ).trim();

const v789gMetadataId = (
  channel: GuideChannel
) =>
  String(
    channel.item.id ||
      channel.item.imdb_id ||
      ''
  ).trim();

// W121ZLIVE147B: Respect array and string-shaped category metadata from
// any installed TV addon. Never infer category from channel name alone.
const w121z147Tokens = (...values: any[]): string[] =>
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === 'string')
    .flatMap((value: string) => value.split(/[;,|]/))
    .map(v789gNormalize)
    .filter(Boolean);


// BU23LP: Normalize explicit provider metadata only.
// Never infer country or genre from a station name.
const bu23lpRegionAliases: Record<string, string> = {
  'usa': 'us',
  'united states': 'us',
  'united states of america': 'us',
  'uk': 'gb',
  'united kingdom': 'gb',
  'great britain': 'gb',
  'canada': 'ca',
  'spain': 'es',
  'mexico': 'mx',
  'argentina': 'ar',
  'colombia': 'co',
  'costa rica': 'cr',
  'peru': 'pe',
  'venezuela': 've',
  'chile': 'cl',
  'bolivia': 'bo',
  'paraguay': 'py',
  'uruguay': 'uy',
  'ecuador': 'ec',
  'dominican republic': 'do',
  'brazil': 'br',
  'germany': 'de',
  'austria': 'at',
  'france': 'fr',
  'italy': 'it',
  'denmark': 'dk',
  'sweden': 'se',
  'norway': 'no',
  'finland': 'fi'
};

const bu23lpNexoMetadata = (channel: GuideChannel) => {
  if (String(channel.addonId || '').trim() !==
      'community.nexotv') {
    return { regions: [] as string[], content: [] as string[] };
  }

  const item: any = channel.item || {};

  const tokens = w121z147Tokens(
    item.genre,
    item.genres,
    item.category,
    item.categories,
    item.region,
    item.regions,
    item.country,
    item.countries,
    item.behaviorHints?.genre,
    item.behaviorHints?.genres,
    item.behaviorHints?.category,
    item.behaviorHints?.categories,
    item.behaviorHints?.regions
  );

  const regions = tokens
    .map(token => bu23lpRegionAliases[token])
    .filter(Boolean);

  const content = tokens.map(token => {
    if (/^news(?:\s*\([^)]*\))?$/.test(token))
      return 'news';
    if (/^music(?:\s*\([^)]*\))?$/.test(token))
      return 'music';
    if (/^documentar(?:y|ies)(?:\s*\([^)]*\))?$/.test(token))
      return 'documentaries';
    if (token === 'weather') return 'weather';
    if (token === 'sport') return 'sports';
    return token;
  });

  return {
    regions: Array.from(new Set(regions)),
    content: Array.from(new Set(content))
  };
};

const v789gGenres = (
  channel: GuideChannel
) => {
  const item: any = channel.item as any;
  return w121z147Tokens(
    item?.genre,
    item?.genres,
    item?.behaviorHints?.genre,
    item?.behaviorHints?.genres,
    bu23lpNexoMetadata(channel).content
  );
};

const v789gPlutoMeta = (
  channel: GuideChannel
) => {
  if (
    String(
      channel.addonId || ''
    ).trim() !== 'org.plutotv'
  ) {
    return null;
  }

  return (
    V789G_CHANNEL_META?.pluto?.[
      v789gMetadataId(channel)
    ] || null
  );
};

const v789gRegions = (channel: GuideChannel): string[] => {
  const item: any = channel.item as any;
  const curated = v789gPlutoMeta(channel)?.regions;
  // Preserve audited Pluto language/region rules exactly.
  if (Array.isArray(curated) && curated.length > 0) {
    return w121z147Tokens(curated);
  }
  return Array.from(new Set(w121z147Tokens(
    item?.region,
    item?.regions,
    item?.country,
    item?.countries,
    item?.behaviorHints?.regions,
    bu23lpNexoMetadata(channel).regions
  )));
};

const v789gCategories = (channel: GuideChannel): string[] => {
  const item: any = channel.item as any;
  const curated = v789gPlutoMeta(channel)?.categories;
  // Do not dilute manually audited Pluto categories with provider strings.
  if (Array.isArray(curated) && curated.length > 0) {
    return w121z147Tokens(curated);
  }
  return Array.from(new Set(w121z147Tokens(
    item?.category,
    item?.categories,
    item?.behaviorHints?.category,
    item?.behaviorHints?.categories
  )));
};

const v789gAllRegionsWithin = (
  regions: string[],
  allowed: Set<string>
) =>
  regions.length > 0 &&
  regions.every((region) =>
    allowed.has(region)
  );

const v789gLanguageBucket = (
  channel: GuideChannel
): V789gCategoryKey | null => {
  const genres =
    v789gGenres(channel);

  const regions =
    v789gRegions(channel);

  const categories =
    v789gCategories(channel);

  if (
    genres.includes('latino') ||
    categories.includes(
      'en espanol'
    ) ||
    v789gAllRegionsWithin(
      regions,
      V789G_SPANISH_REGIONS
    )
  ) {
    return 'spanish';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['br'])
    )
  ) {
    return 'portuguese';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['de', 'at'])
    )
  ) {
    return 'german';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['fr'])
    )
  ) {
    return 'french';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['it'])
    )
  ) {
    return 'italian';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['dk'])
    )
  ) {
    return 'danish';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['se'])
    )
  ) {
    return 'swedish';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['no'])
    )
  ) {
    return 'norwegian';
  }

  if (
    v789gAllRegionsWithin(
      regions,
      new Set(['fi'])
    )
  ) {
    return 'finnish';
  }

  return null;
};

// W121ZSPORTS128I_CURRENT_LIVE_EVENT_SPORTS
//
// Dedicated Sports channels remain controlled by their existing channel
// genre/category metadata. EPG promotion is intentionally restricted to
// audited community.usa-tv-next channels and the program airing RIGHT NOW.
//
// This prevents FAST sitcom/kids/drama/movie channels from entering Sports
// because of future guide text while still allowing a general US network to
// appear temporarily when it is actually carrying a sporting event.
const W121ZSPORTS128I_USA_TV_ADDON_ID =
  'community.usa-tv-next';

const W121ZSPORTS128I_TITLE_PATTERN =
  /\b(?:nfl|nba|wnba|mlb|nhl|mls|ncaa|ncaaf|ncaab|ufc|mma|pga|lpga|atp|wta|nascar|indycar|motogp|formula\s*1|f1|fifa|uefa|premier\s+league|champions\s+league|europa\s+league|la\s+liga|bundesliga|serie\s+a|ligue\s+1|college\s+football|college\s+basketball|super\s+bowl|world\s+series|stanley\s+cup|march\s+madness|wwe|aew|premier\s+boxing\s+champions|top\s+rank\s+boxing)\b/i;

const W121ZSPORTS128I_GENRE_PATTERN =
  /\b(?:sports?|football|basketball|baseball|hockey|soccer|tennis|golf|boxing|wrestling|rugby|cricket|lacrosse|volleyball|motorsports?|motor\s+racing|auto\s+racing|mma)\b/i;

const W121ZSPORTS128I_TEAM_PATTERN =
  /\b(?:cardinals|falcons|ravens|bills|panthers|bears|bengals|browns|cowboys|broncos|lions|packers|texans|colts|jaguars|chiefs|raiders|chargers|rams|dolphins|vikings|patriots|saints|giants|jets|eagles|steelers|49ers|seahawks|buccaneers|titans|commanders|hawks|celtics|nets|hornets|bulls|cavaliers|mavericks|nuggets|pistons|warriors|rockets|pacers|clippers|lakers|grizzlies|heat|bucks|timberwolves|pelicans|knicks|thunder|magic|76ers|suns|trail\s+blazers|kings|spurs|raptors|jazz|wizards|ducks|bruins|sabres|flames|hurricanes|blackhawks|avalanche|blue\s+jackets|stars|red\s+wings|oilers|canadiens|predators|devils|islanders|rangers|senators|flyers|penguins|sharks|kraken|blues|lightning|maple\s+leafs|canucks|golden\s+knights|capitals|diamondbacks|braves|orioles|red\s+sox|cubs|white\s+sox|reds|guardians|rockies|tigers|astros|royals|angels|dodgers|marlins|brewers|twins|mets|yankees|athletics|phillies|pirates|padres|mariners|rays|blue\s+jays|nationals|atlanta\s+united|austin\s+fc|cf\s+montreal|charlotte\s+fc|chicago\s+fire|colorado\s+rapids|columbus\s+crew|dc\s+united|fc\s+cincinnati|fc\s+dallas|houston\s+dynamo|inter\s+miami|la\s+galaxy|lafc|minnesota\s+united|nashville\s+sc|new\s+england\s+revolution|new\s+york\s+city\s+fc|nycfc|new\s+york\s+red\s+bulls|orlando\s+city|philadelphia\s+union|portland\s+timbers|real\s+salt\s+lake|san\s+diego\s+fc|san\s+jose\s+earthquakes|seattle\s+sounders|sporting\s+kansas\s+city|st\s+louis\s+city\s+sc|toronto\s+fc|vancouver\s+whitecaps)\b/i;

const w121zSports128iHasCurrentLiveEvent = (
  channel: GuideChannel
) => {
  if (
    String(channel.addonId || '').trim() !==
      W121ZSPORTS128I_USA_TV_ADDON_ID
  ) {
    return false;
  }

  const now = Date.now();

  const programs =
    Array.isArray(channel.programs)
      ? channel.programs
      : [];

  return programs.some((program: any) => {
    const startMs =
      new Date(
        String(program?.startTime || '')
      ).getTime();

    const endMs =
      new Date(
        String(program?.endTime || '')
      ).getTime();

    // CURRENT program only. Future guide events do not promote a channel.
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs > now ||
      now >= endMs
    ) {
      return false;
    }

    const rawTitle =
      String(program?.title || '').trim();

    const rawGenres =
      Array.isArray(program?.genres)
        ? program.genres
            .map((value: any) =>
              String(value || '').trim()
            )
            .filter(Boolean)
        : [];

    const titleText =
      v789gNormalize(rawTitle);

    const genreText =
      v789gNormalize(
        rawGenres.join(' ')
      );

    if (
      W121ZSPORTS128I_TITLE_PATTERN.test(
        titleText
      ) ||
      W121ZSPORTS128I_GENRE_PATTERN.test(
        genreText
      )
    ) {
      return true;
    }

    const matchupParts =
      rawTitle.split(
        /\s+(?:@|vs\.?|versus|at)\s+/i
      );

    if (matchupParts.length !== 2) {
      return false;
    }

    return (
      W121ZSPORTS128I_TEAM_PATTERN.test(
        matchupParts[0]
      ) &&
      W121ZSPORTS128I_TEAM_PATTERN.test(
        matchupParts[1]
      )
    );
  });
};

const v789gMatchesCategory = (
  channel: GuideChannel,
  category: V789gCategoryKey,
  isFavorite: (
    id: string
  ) => boolean
) => {
  if (category === 'all') {
    return true;
  }

  const favoriteId =
    v789gFavoriteId(channel);

  if (category === 'favorites') {
    return (
      !!favoriteId &&
      isFavorite(favoriteId)
    );
  }

  const addonId =
    String(
      channel.addonId || ''
    ).trim();

  const genres =
    v789gGenres(channel);

  const regions =
    v789gRegions(channel);

  const categories =
    v789gCategories(channel);

  const hasGenre = (
    ...values: string[]
  ) =>
    values.some((value) =>
      genres.includes(value)
    );

  const hasCategory = (
    ...values: string[]
  ) =>
    values.some((value) =>
      categories.includes(value)
    );

  // W121ZLIVE119D_DK_CONTENT_ALIASES
  //
  // Denmark remains the language/region identity.
  // These aliases only let DK feeds also appear in the
  // appropriate content rails.
  const v119dIsDanishOnly =
    regions.length > 0 &&
    regions.every(
      (region) => region === 'dk'
    );

  if (v119dIsDanishOnly) {
    if (
      category === 'comedy' &&
      hasCategory(
        'humor',
        'sitcoms',
        'south park'
      )
    ) {
      return true;
    }

    if (
      category === 'entertainment' &&
      hasCategory(
        'klassiske tv-serier',
        'sci-fi',
        'star trek 60-ars jubil\u00e6um',
        'talkshow',
        'paranormal'
      )
    ) {
      return true;
    }

    if (
      category === 'reality' &&
      hasCategory(
        'realityserier',
        'det bedste fra mtv',
        'dansk reality & underholdning'
      )
    ) {
      return true;
    }

    if (
      category === 'sports' &&
      hasCategory('sport')
    ) {
      return true;
    }

    if (
      category === 'movies' &&
      hasCategory('film')
    ) {
      return true;
    }

    if (
      category === 'kids' &&
      hasCategory('for b\u00f8rn')
    ) {
      return true;
    }

    if (
      category === 'documentary' &&
      hasCategory('dokumentarer')
    ) {
      return true;
    }

    if (
      category === 'lifestyle' &&
      hasCategory('mad & livsstil')
    ) {
      return true;
    }
  }

  if (category === 'us') {
    return (
      addonId ===
        'community.usa-tv-next' ||
      regions.includes('us')
    );
  }

  if (category === 'uk') {
    return regions.some(region =>
      ['gb', 'uk', 'united kingdom'].includes(region)
    );
  }

  if (category === 'canada') {
    return regions.some(region =>
      ['ca', 'canada'].includes(region)
    );
  }

  if (category === 'weather') {
    return hasGenre('weather') || hasCategory('weather');
  }

  if (category === 'news') {
    return (
      hasGenre('news') ||
      hasCategory(
        'news',
        'news + opinion',
        'local news'
      )
    );
  }

  if (category === 'sports') {
    return (
      hasGenre('sports') ||
      hasCategory('sports') ||
      w121zSports128iHasCurrentLiveEvent(channel)
    );
  }

  if (category === 'movies') {
    return hasCategory('movies');
  }

  if (
    category === 'entertainment'
  ) {
    return (
      hasGenre(
        'entertainment',
        'premium'
      ) ||
      hasCategory(
        'entertainment',
        'drama',
        'classic tv',
        'daytime + game shows'
      )
    );
  }

  if (category === 'kids') {
    return (
      hasGenre('kids') ||
      hasCategory('kids')
    );
  }

  if (category === 'crime') {
    return hasCategory(
      'true crime'
    );
  }

  if (category === 'reality') {
    return hasCategory(
      'reality',
      'competition reality'
    );
  }

  if (category === 'comedy') {
    return hasCategory('comedy');
  }

  if (category === 'lifestyle') {
    return (
      hasGenre('lifestyle') ||
      hasCategory(
        'home + food',
        'animals + nature'
      )
    );
  }

  if (
    category === 'documentary'
  ) {
    return (
      hasGenre('documentaries') ||
      hasCategory(
        'history + science',
        'documentary + science'
      )
    );
  }

  if (category === 'music') {
    return (
      hasGenre('music') ||
      hasCategory('music videos')
    );
  }

  if (category === 'anime') {
    return hasCategory('anime');
  }

  return (
    v789gLanguageBucket(
      channel
    ) === category
  );
};

// W121ZLIVE147C_SHADOW_DEDUP_SAFE
// Only de-duplicate *visible* TV stations. The authoritative inventory,
// installed addons, source identities, stream resolver, favorites and channel
// surfing remain unchanged. This first pass removes an unscheduled duplicate
// ONLY when another installed addon has an EXACT display-name match and a
// real provider EPG. Never guess that two differently named feeds are equal.
const w121z147cNameKey = (channel: GuideChannel): string =>
  v789gNormalize(channel.name).replace(/[^a-z0-9]+/g, ' ').trim();

let w121z147cLastSnapshot = '';
const w121z147cGuideDedupe = (
  channels: GuideChannel[],
  isFavorite: (id: string) => boolean
): GuideChannel[] => {
  const byName = new Map<string, GuideChannel[]>();
  for (const channel of channels) {
    const name = w121z147cNameKey(channel);
    if (name.length < 5) continue;
    const group = byName.get(name) || [];
    group.push(channel);
    byName.set(name, group);
  }

  const shadowedKeys = new Set<string>();
  let favoriteGroupsPreserved = 0;
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const providers = new Set(group.map((channel) => String(channel.addonId || '')));
    if (providers.size < 2 || !providers.has('com.stremtv.us')) continue;

    // Preserve each favorite individually. One favorite must not prevent
    // unrelated nonfavorite, unscheduled duplicates from being hidden.
    const protectedFavorites = new Set(group.filter((channel) => {
      const id = v789gFavoriteId(channel);
      return !!id && isFavorite(id);
    }).map((channel) => channel.key));
    if (protectedFavorites.size) favoriteGroupsPreserved += 1;

    // A provider with an EPG is the authoritative displayed guide row.
    // Unscheduled copies are shadowed, but TWO scheduled rows remain visible
    // because their broadcasts or regions could actually be different.
    const scheduled = group.filter((channel) =>
      Array.isArray(channel.programs) && channel.programs.length > 0
    );
    if (!scheduled.length) continue;
    // W121ZEPG177I: one confirmed redundant US broadcaster row.
    // Keep Pluto's programmed guide row and every saved favorite. Do not
    // alter stream resolution, provider data, or other scheduled channels.
    if (w121z147cNameKey(group[0]) === 'abc news live' &&
        scheduled.some((source) => source.addonId === 'org.plutotv' && source.item.id === 'abc-news-live')) {
      for (const channel of group) {
        if (channel.addonId === 'com.stremtv.us' &&
            channel.item.id === 'stremtv-us:ABCNewsLive.us' &&
            !protectedFavorites.has(channel.key)) {
          shadowedKeys.add(channel.key);
        }
      }
    }
    for (const channel of group) {
      if (!channel.programs?.length &&
          !protectedFavorites.has(channel.key) &&
          scheduled.some((source) => source.addonId !== channel.addonId)) {
        shadowedKeys.add(channel.key);
      }
    }
  }

  const digest = `${channels.length}:${shadowedKeys.size}:${favoriteGroupsPreserved}`;
  if (channels.length > 0 && digest !== w121z147cLastSnapshot) {
    w121z147cLastSnapshot = digest;
    console.log(
      '[W121ZLIVE147C VISIBLE GUIDE]',
      `inventoryRows=${channels.length}`,
      `hiddenUnscheduledDuplicates=${shadowedKeys.size}`,
      `visibleRows=${channels.length - shadowedKeys.size}`,
      `favoriteGroupsPreserved=${favoriteGroupsPreserved}`
    );
  }

  return shadowedKeys.size
    ? channels.filter((channel) => !shadowedKeys.has(channel.key))
    : channels;
};

// W121ZLIVE147D_CONFIRMED_BAD_NUMBERED_NEWS_FEEDS
// Reported by device test: ABC News Live numbered copies 1..10 loop on loading.
// Suppress only these exact display names, never the working unnumbered
// ABC News Live station. This is display-only: addon inventory and favorites
// records remain intact and recoverable.
const w121z147dConfirmedDead = (channel: GuideChannel): boolean => {
  const name = v789gNormalize(channel.name)
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return /^abc news live (?:0?[1-9]|10|1 10)$/.test(name);
};

// W121ZLIVE148C: exact add-on/channel quarantine from the full 148B source scan.
// 34 repeated HTTP 404 sources, plus user-verified BET (Cable) loading loop.
// This is a VISIBLE GUIDE FILTER ONLY: do not delete provider inventory,
// streams, saved favorite identities, or replace any player's source.
const w121z148cStremTvQuarantine = new Set<string>([
  "stremtv-us:30ALionelNation.us",
  "stremtv-us:30ALoomeredTV.us",
  "stremtv-us:ABCNewsLive1.us",
  "stremtv-us:ABCNewsLive10.us",
  "stremtv-us:ABCNewsLive2.us",
  "stremtv-us:ABCNewsLive3.us",
  "stremtv-us:ABCNewsLive4.us",
  "stremtv-us:ABCNewsLive5.us",
  "stremtv-us:ABCNewsLive6.us",
  "stremtv-us:ABCNewsLive7.us",
  "stremtv-us:ABCNewsLive8.us",
  "stremtv-us:ABCNewsLive9.us",
  "stremtv-us:AlFadyTV.us",
  "stremtv-us:CBSNewsBayArea.us",
  "stremtv-us:CBSNewsBoston.us",
  "stremtv-us:CBSNewsChicago.us",
  "stremtv-us:CBSNewsColorado.us",
  "stremtv-us:CBSNewsDetroit.us",
  "stremtv-us:CBSNewsLosAngeles.us",
  "stremtv-us:CBSNewsMinnesota.us",
  "stremtv-us:CBSNewsNewYork.us",
  "stremtv-us:CBSNewsPittsburgh.us",
  "stremtv-us:MCPSSTV.us",
  "stremtv-us:NewsmaxSpanish.us",
  "stremtv-us:PixLTV.us",
  "stremtv-us:RTHTV1.us",
  "stremtv-us:RTHTV2Gospel.us",
  "stremtv-us:TVSFilmNoirNetwork.us",
  "stremtv-us:VisionLatinaNetwork.us",
  "stremtv-us:W14DKD141.us",
  "stremtv-us:YoutooAmerica.us",
  "stremtv-us:m3u-us-BET__Cable_",
  "stremtv-us:m3u-us-FX",
  "stremtv-us:m3u-us-STARZ",
  "stremtv-us:m3u-us-Showtime",
]);
const w121z148cIsQuarantined = (channel: GuideChannel): boolean => {
  if (String(channel.addonId || '').trim() !== 'com.stremtv.us') return false;
  const id = String(channel.item?.id || channel.item?.imdb_id || '').trim();
  return w121z148cStremTvQuarantine.has(id);
};

const v789gFilterChannels = (
  channels: GuideChannel[],
  category: V789gCategoryKey,
  isFavorite: (
    id: string
  ) => boolean
) => {
  // Remove only explicitly reported dead guide rows, including Favorites.
  // Do not delete a saved favorite or mutate the owner stream inventory.
  const eligible = channels.filter((channel) => !w121z148cIsQuarantined(channel));
  // Never de-duplicate Favorites; surviving saved identities stay reachable.
  const source = category === 'favorites'
    ? eligible
    : w121z147cGuideDedupe(eligible, isFavorite);
  return source.filter((channel) =>
    v789gMatchesCategory(channel, category, isFavorite)
  );
};
const localDateKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const floorHalfHour = (ms: number) =>
  Math.floor(ms / SLOT_MS) * SLOT_MS;

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

export default function LiveTVScreen() {
  // BU23IO: guide-owned health refresh, even when Add-ons is closed.
  // Delayed until navigation settles; cancel before playback navigation.
  // This is NOT an Android background service and does not run during playback.
  useFocusEffect(useCallback(() => {
    let active = true;
    const check = () => {
      if (active) void runBU23IOGuideHealthRecheck(() => active);
    };
    const initial = setTimeout(check, 30000);
    const interval = setInterval(check, 15 * 60 * 1000);
    return () => { active = false; clearTimeout(initial); clearInterval(interval); };
  }, []));

  // W121ZLIVE178Q: confirmed malformed HLS feeds remain hidden until verified playback success.
  // No time-based visibility restores; backend verification is not implemented yet.
  const [w178pHealth, w178pSetHealth] = useState<FeedHealthRegistry>({});
  const [bu23hzAddonHealth, bu23hzSetAddonHealth] = useState<BU23HZAddonRegistry>({});
  useEffect(() => {
    let active = true;
    const refresh = () => { void loadBU23HZAddonHealth().then(next => {
      if (active) bu23hzSetAddonHealth(next);
    }); };
    refresh();
    const sub = DeviceEventEmitter.addListener(BU23HZ_ADDON_EVENT, refresh);
    return () => { active = false; sub.remove(); };
  }, []);
  const [w178pClock, w178pSetClock] = useState(Date.now());
  useEffect(() => {
    let active = true;
    const refresh = () => { void loadLiveHealth().then(next => {
      if (active) { w178pSetHealth(next); w178pSetClock(Date.now()); }
    }); };
    refresh();
    const subscription = DeviceEventEmitter.addListener('W121ZLIVE178P_HEALTH_CHANGED', refresh);
    const interval = setInterval(refresh, 60000);
    return () => { active = false; subscription.remove(); clearInterval(interval); };
  }, []);

  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const timelineRef = useRef<ScrollView>(null);
  // W121ZLIVE148F: one native Select -> one frozen add-on/channel launch.
  // Native guide focus may continue to move while the stream resolver runs.
  const w121z148fLaunchRef = useRef<string | null>(null);
  const [w121z148fOpening, setW121z148fOpening] = useState('');
  // W121ZLIVE148G: visually match the existing player loading experience.
  const [w121z148gOpeningLogo, setW121z148gOpeningLogo] = useState('');
  // W121ZLIVE148I: the loader is now owned by app/_layout.tsx,
  // not this guide screen. A screen-owned Modal is torn down during
  // Stack navigation, which exposed a frame of the EPG between loaders.
  const w121z148hAttemptSeqRef = useRef(0);
  // Keep one native loading cover across navigation. The player signals
  // when real playback begins, or if it needs to show an error. No second
  // player loader is exposed during the normal launch.
  const w121z148hRouteActiveRef = useRef(false);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'W121ZLIVE148I_COVER_BACK', (event: any) => {
        const key = String(event?.addonId || '') + ':' + String(event?.contentId || '');
        if (w121z148fLaunchRef.current !== key) return;
        // Cancel any still-pending stream resolution before hiding cover.
        ++w121z148hAttemptSeqRef.current;
        w121z148fLaunchRef.current = null;
        setW121z148fOpening('');
        setW121z148gOpeningLogo('');
        const wasInPlayer = w121z148hRouteActiveRef.current;
        w121z148hRouteActiveRef.current = false;
        if (wasInPlayer) router.back();
        console.log('[W121ZLIVE148I BACK CANCEL]', 'channel=' + key);
      }
    );
    return () => sub.remove();
  }, [router]);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'W121ZLIVE148H_PLAYER_COVER_END', (event: any) => {
        const key = String(event?.addonId || '') + ':' + String(event?.contentId || '');
        if (!w121z148hRouteActiveRef.current ||
            w121z148fLaunchRef.current !== key) return;
        console.log('[W121ZLIVE148H SINGLE LOADER REVEAL]',
          'channel=' + key, 'reason=' + String(event?.reason || ''));
        setW121z148fOpening('');
        setW121z148gOpeningLogo('');
      }
    );
    return () => sub.remove();
  }, []);


  // V788T6B_PINNED_GUIDE_HEADER
  const timelineHeaderRef =
    useRef<ScrollView>(null);

  // V788T8L_NATIVE_STATION_PROGRAM_SYNC
  const v788t8lProgramVerticalRef =
    useRef<ScrollView>(null);

  // V788T6B_FOCUS_REGISTRY_STABILITY
  // Inline callback refs can receive null and then reattach
  // during an ordinary React render. Delay unregister by one
  // turn so that transient ref churn does not rebuild every
  // native TV focus link.
  const v788t6PendingUnregisterRef =
    useRef<Map<string, ReturnType<typeof setTimeout>>>(
      new Map()
    );

  // V788S1_STABLE_PROGRAM_VERTICAL_ANCHOR
  const v788sProgramAnchorRef =
    useRef<number | null>(null);

  const v788sLastProgramRowRef =
    useRef<number | null>(null);

  // V788N4A_DETERMINISTIC_PROGRAM_VERTICAL_FOCUS
  // Registry contains only currently mounted V788H guide cells.
  const v788nProgramFocusMapRef =
    useRef<Map<string, any>>(new Map());

  const v788nFocusWireTimerRef =
  useRef<ReturnType<typeof setTimeout> | null>(null);

  // V788T7B_DETERMINISTIC_STATION_VERTICAL_FOCUS
  const v788t7StationFocusMapRef =
    useRef<Map<string, any>>(new Map());

  const v788t7StationFocusWireTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null
    );

  const v788t7PendingStationUnregisterRef =
    useRef<Map<string, ReturnType<typeof setTimeout>>>(
      new Map()
    );

// V788P5D_POSTER_STYLE_CHANNEL_BOOKMARK
const v788pFocusedStationKeyRef =
  useRef<string | null>(null);

// V788T8C3_GUIDE_TRAY_EXIT
const v788t8cFocusAreaRef =
  useRef<'station' | 'program' | 'none'>('none');

const v788t8cFocusedRowRef =
  useRef<number | null>(null);

const v788t8cChannelCountRef = useRef(0);
const v788t8cFirstLeftRef = useRef(0);
const v788t8cRawLeftRef = useRef(0);

// V789S9_PROGRAM_TO_STATION_LEFT_GUARD
// Native guide focus reaches JS before useTVEventHandler receives the same
// LEFT key-up. Remember that one program -> station transition so the LEFT
// which merely returned to the channel column cannot arm the tray timer.
const v789s9ProgramToStationLeftRef = useRef(0);

// V789S10_ROW1_TO_ROW0_UP_GUARD
// Native guide focus reaches row 0 before useTVEventHandler receives the same
// UP key-up that moved row 1 -> row 0. Remember that transition so that one
// UP only lands on channel row 0. A later UP from row 0 may enter Categories.
const v789s10RowOneToZeroUpRef = useRef(0);

// V789K_SINGLE_VS_DOUBLE_LEFT
const v789kSingleLeftTimerRef =
  useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
// V788T8Y_R3_TRAY_ACK_HANDSHAKE
const v788t8yTrayPendingRef =
  useRef(false);

const v788t8yTrayTimeoutRef =
  useRef<any>(null);

const v788t8cFocusTray = useCallback(() => {
  // Guide still owns Android focus here.
  // Do not erase guide focus state yet.
  v788t8cFirstLeftRef.current = 0;
  v788t8cRawLeftRef.current = 0;
  v788t8yTrayPendingRef.current = true;

  if (v788t8yTrayTimeoutRef.current) {
    clearTimeout(
      v788t8yTrayTimeoutRef.current
    );
  }

  console.log(
    '[V788T8Y TRAY] REQUEST'
  );

  DeviceEventEmitter.emit(
    'v788t8c:focusLiveTvTray'
  );

  v788t8yTrayTimeoutRef.current =
    setTimeout(() => {
      if (!v788t8yTrayPendingRef.current) {
        return;
      }

      v788t8yTrayPendingRef.current = false;

      console.log(
        '[V788T8Y TRAY] NO ACK - GUIDE PRESERVED'
      );
    }, 700);
}, []);

useEffect(() => {
  const subscription =
    DeviceEventEmitter.addListener(
      'v788t8y:liveTvTrayFocused',
      () => {
        if (!v788t8yTrayPendingRef.current) {
          return;
        }

        v788t8yTrayPendingRef.current = false;

        if (v788t8yTrayTimeoutRef.current) {
          clearTimeout(
            v788t8yTrayTimeoutRef.current
          );

          v788t8yTrayTimeoutRef.current = null;
        }

        // Tray now REALLY owns Android focus.
        v788t8cFocusAreaRef.current = 'none';
        v788t8cFocusedRowRef.current = null;
        v788t8cFirstLeftRef.current = 0;
        v788t8cRawLeftRef.current = 0;

        console.log(
          '[V788T8Y TRAY] ACK'
        );
      }
    );

  return () => {
    subscription.remove();

    if (v788t8yTrayTimeoutRef.current) {
      clearTimeout(
        v788t8yTrayTimeoutRef.current
      );
    }
  };
}, []);

const v788pStationLongPressRef =
  useRef<(() => void) | null>(null);

// W121ZLIVE123_SCREEN_FOCUS_OWNER
//
// Live TV remains mounted underneath other routes/tabs. Native/JS TV
// handlers must only own remote input while Live itself owns navigation
// focus. Without this guard, a hidden Live station can consume an OD
// long-press and mutate the Live favorites library.
const w121zlive123ScreenFocusedRef =
  useRef(false);

const v788pToggleFavoriteRef =
  useRef<
    (
      (
        channel: GuideChannel
      ) => void | Promise<void>
    ) | null
  >(null);

const v788pClearStationLongPress =
  useCallback(
    (expectedKey?: string) => {
      if (
        expectedKey &&
        v788pFocusedStationKeyRef.current !==
          expectedKey
      ) {
        return;
      }

      v788pFocusedStationKeyRef.current =
        null;

      v788pStationLongPressRef.current =
        null;

      try {
        v176iRegisterGetter(null);
      } catch (_) {}
    },
    []
  );

// V788P5D_NAV_DIAG
useTVEventHandler((event: any) => {
  // W121ZLIVE123_SCREEN_FOCUS_OWNER
  // The tab stays mounted when OD/player owns the screen. Hidden Live
  // must not interpret those remote keys as guide/category/favorite input.
  if (!w121zlive123ScreenFocusedRef.current) {
    return;
  }

  const type =
    String(
      event?.eventType || ''
    ).toLowerCase();

  if (
    type === 'up' ||
    type === 'down' ||
    type === 'left' ||
    type === 'right' ||
    type === 'select' ||
    type === 'longselect'
  ) {
    console.log(
      '[V788P5D NAV KEY] ' +
      type
    );

    // V788T8C3_GUIDE_TRAY_EXIT
    const focusArea = v788t8cFocusAreaRef.current;
    const row = v788t8cFocusedRowRef.current;

    // V789M_EXPLICIT_CATEGORY_BOUNDARIES
    //
    // The category row owns its own focus while active.
    // DOWN deliberately returns to filtered guide row 0.
    // V789Q2_GLOBAL_CATEGORY_DOWN_OWNER
    //
    // Runtime proof on Google TV shows the global TV handler receives
    // category DOWN while the native category-item DOWN handler does not.
    // Use one owner only: select the actually-focused category and reuse
    // the existing category-select -> guide-row-0 transaction.
    if (
      type === 'down' &&
      v789hCategoryModeRef.current &&
      v789hCategoryFocusedIndexRef.current >= 0
    ) {
      const highlightedIndex =
        v789hCategoryFocusedIndexRef.current;

      const highlightedCategory =
        V789G_CATEGORY_DEFS[
          highlightedIndex
        ];

      // V789S9_DOWN_EXITS_ONLY
      //
      // Highlighting a category is not selection. DOWN must never mutate the
      // selected filter. It only exits Categories into the guide for the
      // category that was last committed with OK.
      console.log(
        '[V789S9 CATEGORY DOWN EXIT] ' +
          'highlighted=' +
          String(
            highlightedCategory?.key ||
            ''
          ) +
          ' selected=' +
          v789gCategory
      );

      v789mCategoryExitPendingRef.current =
        true;

      // BU23OK: with no rows, keep the category rail usable.
      if (v788t8cChannelCountRef.current === 0) {
        v789mCategoryExitPendingRef.current = false;
        return;
      }

      // Re-enter the currently selected guide at its first visible row.
      // For a just-selected/remounted guide that naturally resolves to row 0.
      setPreferredChannelIndex(
        -1
      );

      setV788t8vFocusRestoreRequest(
        (request) => ({
          index: -1,
          serial: request.serial + 1,
        })
      );

      return;
    }
    // UP from the first CHANNEL row enters the
    // category row on the currently-selected category.
    //
    // Normal native RecyclerView Up/Down remains untouched
    // for every other guide row.
    if (
      type === 'up' &&
      focusArea === 'station' &&
      row === 0
    ) {
      // V789S10_ROW1_TO_ROW0_UP_GUARD
      // The native guide reports row 0 before this same UP key-up reaches JS.
      // If row 1 -> row 0 just happened, this UP belongs to that move and must
      // not be reinterpreted as a second UP originating from row 0.
      const now = Date.now();
      const rowOneToZeroAt =
        v789s10RowOneToZeroUpRef.current;

      if (
        rowOneToZeroAt > 0 &&
        now - rowOneToZeroAt <= 350
      ) {
        v789s10RowOneToZeroUpRef.current = 0;

        console.log(
          '[V789S10 ROW1 TO ROW0 UP] stay-guide'
        );

        return;
      }

      v789s10RowOneToZeroUpRef.current = 0;

      const stationKey =
        v788pFocusedStationKeyRef.current;

      const channel =
        stationKey
          ? channels.find(
              (candidate) =>
                candidate.key ===
                stationKey
            )
          : undefined;

      console.log(
        '[V789M TOP ROW UP] ' +
          'channel=' +
          String(stationKey || '')
      );

      if (channel) {
        setTimeout(
          () =>
            v789gOpenCategoriesFromChannel(
              channel
            ),
          0
        );
      }

      return;
    }
    if (
      type === 'down' &&
      row != null &&
      row === v788t8cChannelCountRef.current - 1
    ) {
      setTimeout(v788t8cFocusTray, 0);
      return;
    }

    // V789K_SINGLE_VS_DOUBLE_LEFT
    if (
      focusArea === 'station' &&
      type === 'left'
    ) {
      const now = Date.now();

      // V789S9_PROGRAM_TO_STATION_LEFT_GUARD
      // onItemFocus reports station before this same LEFT reaches the JS TV
      // handler. Consume that one LEFT here instead of treating it as a new
      // station-column LEFT intended for tray/categories.
      const programReturnAt =
        v789s9ProgramToStationLeftRef.current;

      if (
        programReturnAt > 0 &&
        now - programReturnAt <= 500
      ) {
        v789s9ProgramToStationLeftRef.current =
          0;

        v788t8cFirstLeftRef.current =
          0;

        v788t8cRawLeftRef.current =
          0;

        if (
          v789kSingleLeftTimerRef.current
        ) {
          clearTimeout(
            v789kSingleLeftTimerRef.current
          );

          v789kSingleLeftTimerRef.current =
            null;
        }

        console.log(
          '[V789S9 PROGRAM RETURN LEFT CONSUMED]'
        );

        return;
      }

      v789s9ProgramToStationLeftRef.current =
        0;

      if (
        now -
          v788t8cRawLeftRef.current <
        100
      ) {
        return;
      }

      v788t8cRawLeftRef.current =
        now;

      const first =
        v788t8cFirstLeftRef.current;

      if (
        first > 0 &&
        now - first >= 100 &&
        now - first <= 400
      ) {
        if (
          v789kSingleLeftTimerRef.current
        ) {
          clearTimeout(
            v789kSingleLeftTimerRef.current
          );

          v789kSingleLeftTimerRef.current =
            null;
        }

        v788t8cFirstLeftRef.current =
          0;

        v788t8cRawLeftRef.current =
          0;

        const stationKey =
          v788pFocusedStationKeyRef.current;

        const channel =
          stationKey
            ? channels.find(
                (candidate) =>
                  candidate.key ===
                  stationKey
              )
            : undefined;

        console.log(
          '[V789K DOUBLE LEFT] ' +
            'category rail ' +
            String(stationKey || '')
        );

        if (channel) {
          setTimeout(
            () =>
              v789gOpenCategoriesFromChannel(
                channel
              ),
            0
          );
        }

        return;
      }

      v788t8cFirstLeftRef.current =
        now;

      if (
        v789kSingleLeftTimerRef.current
      ) {
        clearTimeout(
          v789kSingleLeftTimerRef.current
        );
      }

      v789kSingleLeftTimerRef.current =
        setTimeout(
          () => {
            v789kSingleLeftTimerRef.current =
              null;

            v788t8cFirstLeftRef.current =
              0;

            v788t8cRawLeftRef.current =
              0;

            console.log(
              '[V789K SINGLE LEFT] tray'
            );

            v788t8cFocusTray();
          },
          400
        );

      return;
    }
    // V789K_CANCEL_PENDING_SINGLE_LEFT
    if (
      type !== 'left' &&
      v789kSingleLeftTimerRef.current
    ) {
      clearTimeout(
        v789kSingleLeftTimerRef.current
      );

      v789kSingleLeftTimerRef.current =
        null;
    }
    if (type !== 'left') {
      v788t8cFirstLeftRef.current = 0;
      v788t8cRawLeftRef.current = 0;
    }
  }
});

  // V788H1_LIVE_GUIDE_WINDOWING
  // Keep the existing synchronized ScrollView structure, but only mount
  // rows near the current vertical viewport.
  const [v788hViewportRow, setV788hViewportRow] = useState(0);

  // V785L6B_LIVE_GUIDE_FOCUS_RETURN
  const [preferredChannelIndex, setPreferredChannelIndex] =
  useState(0);

// V788Q1_ONE_SHOT_PREFERRED_FOCUS
// hasTVPreferredFocus is only allowed to restore initial/return focus.
// It must NOT chase ordinary D-pad focus.
const v788qPreferredFocusArmedRef =
  useRef(true);
  const loadGenerationRef = useRef(0); // V784L_LIVE_TV_FOCUS_REFRESH

  // W121ZLIVE122_LIVE_FOCUS_OWNED_CANCEL
  //
  // A mounted Live tab must not retain ownership of expensive guide
  // HTTP/inventory work after Live loses focus. The already-painted
  // guide is preserved; only unfinished background work is cancelled.
  const w121zlive122GuideAbortRef =
    useRef<any>(null);
  const v788t10gRefreshResultRef = useRef<GuideChannel[] | null>(null);

  // V785A_LIVE_GUIDE_PERSIST
  // Keep the already-rendered guide resident while /player sits above it.
  // Returning from playback must not blank/rebuild the guide.
  const guideLoadedRef = useRef(false);
  const guideLoadInFlightRef = useRef(false);
  const lastGuideLoadAtRef = useRef(0);

  const library = useContentStore((s) => s.library);
  const fetchLibrary = useContentStore((s) => s.fetchLibrary);
  const addToLibrary = useContentStore((s) => s.addToLibrary);
  const removeFromLibrary = useContentStore((s) => s.removeFromLibrary);

  const [channels, setChannels] = useState<GuideChannel[]>([]);
  v788t8cChannelCountRef.current = channels.length;
  const [loading, setLoading] = useState(true);

  // V787I_GUIDE_NOW_PLAYING_CLOCK
  const [now, setNow] = useState(() => Date.now());
 useEffect(() => {
   const timer = setInterval(
     () => setNow(Date.now()),
     30000
   );

   return () =>
     clearInterval(timer);
 }, []);

 // V788P5D_HALF_HOUR_BOUNDARY_TICK
 useEffect(() => {
   let timer:
     | ReturnType<typeof setTimeout>
     | null = null;

   const scheduleBoundary = () => {
     const current =
       Date.now();

     const next =
       floorHalfHour(current) +
       SLOT_MS;

     timer =
       setTimeout(
         () => {
           setNow(Date.now());
           scheduleBoundary();
         },
         Math.max(
           50,
           next - current + 50
         )
       );
   };

   scheduleBoundary();

   return () => {
     if (timer !== null) {
       clearTimeout(timer);
     }
   };
 }, []);
  // V788P5D_CURRENT_HALF_HOUR
const timelineStart = floorHalfHour(now);
  const timelineEnd = timelineStart + SLOT_COUNT * SLOT_MS;
  const guideWidth = SLOT_COUNT * SLOT_WIDTH;

  // V788H1_LIVE_GUIDE_WINDOWING
  // A TV screen only displays a handful of guide rows. Keep a generous
  // twelve-row buffer on either side so native D-pad focus always has
  // upcoming rows mounted before the ScrollView reaches them.
  const v788hVisibleRows = Math.max(
    8,
    Math.ceil(height / ROW_HEIGHT) + 2
  );

  const v788hOverscanRows = 12;

  // V788T8B_NAV_LOW_CHURN_WINDOW
  // Keep the same 12-row safety buffer.
  // Advance the React render window only every four rows
  // instead of rebuilding mounted focusables every row.
  const v788t8WindowStepRows = 4;

  const v788hRenderStart = Math.max(
    0,
    v788hViewportRow - v788hOverscanRows
  );

  const v788hRenderEnd = Math.min(
    channels.length,
    v788hViewportRow +
      v788hVisibleRows +
      v788hOverscanRows
  );

  const v788hRenderChannels = channels.slice(
    v788hRenderStart,
    v788hRenderEnd
  );

  const v788hTopSpacerHeight =
    v788hRenderStart * ROW_HEIGHT;

  const v788hBottomSpacerHeight =
    Math.max(
      0,
      channels.length - v788hRenderEnd
    ) * ROW_HEIGHT;

  // W121ZPLAY10Y24Q_LIBRARY_CHANNEL_ID_ALIASES
  // The library API has used both channels[] and tv[] for
  // Live TV entries. Preserve every supported identity alias
  // instead of choosing only the first imdb_id/id value.
  const favoriteIds = useMemo(() => {
    const out = new Set<string>();

    const libraryChannels: any[] =
      ([] as any[]).concat(
        (library as any)?.channels || [],
        (library as any)?.tv || []
      );

    for (const item of libraryChannels) {
      const aliases = [
        item?.content_id,
        item?.imdb_id,
        item?.id,
      ];

      for (const raw of aliases) {
        const id = String(raw || '').trim();
        if (id) out.add(id);
      }
    }

    return out;
  }, [library]);

  // W121ZPLAY10Y24L_STABLE_FAVORITE_PREDICATE
  // Library/override changes must not invalidate the complete guide
  // filtering + program-map chain. Read current values through refs
  // while keeping v788t8xIsFavorite identity stable.
  const v788y24lFavoriteIdsRef = useRef(favoriteIds);
  v788y24lFavoriteIdsRef.current = favoriteIds;

  // V788T8X_REALTIME_BOOKMARK
  const [
    v788t8xFavoriteOverrides,
    setV788t8xFavoriteOverrides,
  ] = useState<Record<string, boolean>>({});

  const v788y24lFavoriteOverridesRef =
    useRef<Record<string, boolean>>(
      v788t8xFavoriteOverrides
    );

  v788y24lFavoriteOverridesRef.current =
    v788t8xFavoriteOverrides;

  // W121ZPLAY10Y23A_DIRECT_GUIDE_FAVORITE_REFS
  // Visible station stars are owned by the mounted whole-row native guide.
  const v788y23GuideRef = useRef<any>(null);
  const v788y23GuideItemsRef = useRef<any[]>([]);

  const v788t8xIsFavorite = useCallback(
    (id: string) => {
      const overrides =
        v788y24lFavoriteOverridesRef.current;

      if (
        Object.prototype.hasOwnProperty.call(
          overrides,
          id
        )
      ) {
        return overrides[id];
      }

      return v788y24lFavoriteIdsRef.current.has(id);
    },
    []
  );

  // V789G_R1_LIVE_TV_CATEGORY_STATE
  const [
    v789gCategory,
    setV789gCategory,
  ] =
    useState<V789gCategoryKey>(
      'favorites'
    );

  // V789H_EXPLICIT_CATEGORY_FOCUS
  const v789gCategoryScrollRef =
    useRef<ScrollView>(null);

  const v789hCategoryRefs =
    useRef<Array<any | null>>(
      []
    );

  const [
    v789hCategoryTags,
    setV789hCategoryTags,
  ] =
    useState<number[]>([]);

  const [
    v789hCategoryMode,
    setV789hCategoryMode,
  ] =
    useState(false);

  const v789hCategoryModeRef =
    useRef(false);

  const v789hCategoryFocusedIndexRef =
    useRef(-1);
  // V789M_R6_EXIT_PENDING
  // Keep categories alive until the native guide
  // positively confirms it owns focus.
  const v789mCategoryExitPendingRef =
    useRef(false);

  // V789N_NATIVE_CATEGORY_SWITCH
  const [
    v789nNativeCategoryPreferredIndex,
    setV789nNativeCategoryPreferredIndex,
  ] =
    useState(0);

  const [
    v789nNativeCategoryFocusSerial,
    setV789nNativeCategoryFocusSerial,
  ] =
    useState(0);
  // V789N_MEASURED_CATEGORY_VIEWPORT
  //
  // Category pills have different real widths.
  // Never infer horizontal geometry from category index.
  const v789nCategoryLayoutsRef =
    useRef<
      Array<
        {
          x: number;
          width: number;
        } | null
      >
    >([]);

  const v789nCategoryScrollXRef =
    useRef(0);

  const v789nCategoryViewportWidthRef =
    useRef(0);

  // V789N_ENSURE_CATEGORY_VISIBLE
  const v789nEnsureCategoryVisible =
    useCallback(
      (
        index: number,
        animated = false
      ) => {
        const layout =
          v789nCategoryLayoutsRef
            .current[index];

        const viewportWidth =
          v789nCategoryViewportWidthRef
            .current;

        if (
          !layout ||
          viewportWidth <= 0
        ) {
          return;
        }

        const currentX =
          v789nCategoryScrollXRef
            .current;

        const margin = 28;

        const leftEdge =
          currentX + margin;

        const rightEdge =
          currentX +
          viewportWidth -
          margin;

        const itemLeft =
          layout.x;

        const itemRight =
          layout.x +
          layout.width;

        let targetX =
          currentX;

        if (
          itemLeft < leftEdge
        ) {
          targetX =
            Math.max(
              0,
              itemLeft - margin
            );
        }
        else if (
          itemRight > rightEdge
        ) {
          targetX =
            Math.max(
              0,
              itemRight -
                viewportWidth +
                margin
            );
        }

        if (
          Math.abs(
            targetX - currentX
          ) < 2
        ) {
          return;
        }

        console.log(
          '[V789N CATEGORY SCROLL] ' +
            'index=' +
            index +
            ' current=' +
            Math.round(currentX) +
            ' target=' +
            Math.round(targetX) +
            ' x=' +
            Math.round(layout.x) +
            ' width=' +
            Math.round(layout.width)
        );

        v789nCategoryScrollXRef
          .current =
          targetX;

        v789gCategoryScrollRef
          .current?.scrollTo({
            x: targetX,
            animated,
          });
      },
      []
    );
  const v789hRegisterCategoryRef =
    useCallback(
      (
        index: number,
        node: any
      ) => {
        v789hCategoryRefs.current[
          index
        ] = node;

        if (!node) {
          return;
        }

        let tag = 0;

        try {
          tag =
            Number(
              findNodeHandle(node) ||
                0
            );
        } catch (_) {
          tag = 0;
        }

        if (tag <= 0) {
          return;
        }

        setV789hCategoryTags(
          (previous) => {
            if (
              previous[index] ===
              tag
            ) {
              return previous;
            }

            const next =
              previous.slice();

            next[index] = tag;

            return next;
          }
        );
      },
      []
    );

  const [
    v789gFavoriteActionChannel,
    setV789gFavoriteActionChannel,
  ] =
    useState<GuideChannel | null>(
      null
    );

  // W121ZPLAY10Y24L_FAVORITES_STRUCTURE_TOKEN
  // Outside Favorites, bookmark-state changes must not rebuild
  // the full visible guide. Inside Favorites, preserve immediate
  // add/remove membership behavior.
  const bu23okLibraryFavoritesToken = v789gCategory === 'favorites' ? favoriteIds : null;
  const v788y24lFavoritesStructureToken =
    v789gCategory === 'favorites'
      ? v788t8xFavoriteOverrides
      : null;

  // W121ZSPORTS128I_CURRENT_EVENT_CLOCK
  //
  // The existing guide clock ticks every 30 seconds. Only make that clock a
  // filtering dependency while Sports is selected so general-network event
  // membership enters/exits automatically at program boundaries without
  // rebuilding every other Live TV category.
  const w121zSports128iClockToken =
    v789gCategory === 'sports'
      ? now
      : 0;

  const v789gVisibleChannels =
    useMemo(
      () =>
        v789gFilterChannels(
          channels,
          v789gCategory,
          v788t8xIsFavorite
        ).filter((channel) =>
          // W121ZLIVE172F: NexoTV publishes synthetic ratelimit_error as a catalog item.
          // Never show it as a playable television station (including cached rows).
          String(channel.item?.imdb_id || channel.item?.id || '')
            .trim().toLowerCase() !== 'ratelimit_error'
        ).filter((channel) => !temporarilyHidden(
          w178pHealth,
          channel.addonId || (channel.item as any)?.addonId || '',
          channel.item?.imdb_id || channel.item?.id || '',
          w178pClock
        )).filter((channel) => !isAddonConfirmedDown(
          bu23hzAddonHealth,
          channel.addonId || (channel.item as any)?.addonId || ''
        )).filter((channel) => {
          // W121ZLIVE178R: fail-closed quarantine of the reported 30A
          // station group pending genuine video+audio playback verification.
          // Do NOT treat the group as individually proven broken. No timer
          // re-enables these rows; verified feed health must govern restoration.
          const channelId = String(channel.item?.imdb_id || channel.item?.id || '').trim();
          return !/^stremtv-us:30A/i.test(channelId);
        }),
      [
        channels,
        v789gCategory,
        v788t8xIsFavorite,
        v788y24lFavoritesStructureToken,
        bu23okLibraryFavoritesToken,
        w121zSports128iClockToken,
        w178pHealth,
        w178pClock,
        bu23hzAddonHealth,
      ]
    );

  // W121ZSY3_VISIBLE_IDENTITY_DOMAIN
  //
  // LiveTvNav and the native guide must resolve rows against
  // the same filtered channel domain the user actually sees.
  // Refs let the focus-return callback read current state
  // without turning category/favorite changes into focus-effect
  // re-subscriptions.
  const v789gVisibleChannelsRef =
    useRef(v789gVisibleChannels);

  v789gVisibleChannelsRef.current =
    v789gVisibleChannels;

  const v789gCategoryRef =
    useRef(v789gCategory);

  v789gCategoryRef.current =
    v789gCategory;

  const v788t8xIsFavoriteRef =
    useRef(v788t8xIsFavorite);

  v788t8xIsFavoriteRef.current =
    v788t8xIsFavorite;

  // V789S16E_HIDE_EMPTY_LIVE_TV_CATEGORIES
  // W121ZPLAY10Y13A_PIN_FAVORITES_FIRST
  //
  // Favorites stays visible at index 0 even when empty so long-press can add the first station.
  // Other categories still require at least one playable row.
  // W121ZEPG161AC: compute eligible and deduped channel inventory ONCE
  // for the category menu, instead of redoing full-list work per category.
  // The selected guide still uses the original v789gFilterChannels path.
  const v789gVisibleCategoryDefs =
    useMemo(() => {
      const startedAt = Date.now();
      const eligible = channels.filter(
        (channel) => !w121z148cIsQuarantined(channel)
      );
      const source = w121z147cGuideDedupe(eligible, v788t8xIsFavorite);
      const result = V789G_CATEGORY_DEFS.filter((category) =>
        category.key === 'favorites' ||
        source.some((channel) =>
          v789gMatchesCategory(channel, category.key, v788t8xIsFavorite)
        )
      );
      console.log('[W121ZEPG161AC CATEGORY MENU] channels=' + channels.length +
        ' eligible=' + eligible.length + ' deduped=' + source.length +
        ' categories=' + result.length + ' buildMs=' + (Date.now() - startedAt));
      return result;
    }, [channels, v788t8xIsFavorite]);

  // Native focus callbacks can outlive a render. Keep their category
  // index mapping tied to the same visible list the user actually sees.
  const v789gVisibleCategoryDefsRef =
    useRef(v789gVisibleCategoryDefs);

  v789gVisibleCategoryDefsRef.current =
    v789gVisibleCategoryDefs;

  // BU23OK: the selected category is initialized to Favorites before any
  // inventory/library response. Never select a category from async data.
  const bu23okPlaybackReturnRef = useRef(false);

  // If the selected category genuinely
  // disappears, prefer US Channels instead of blindly using
  // category index zero.
  useEffect(() => {
    if (
      v789gVisibleCategoryDefs.length <= 0 ||
      v789gVisibleCategoryDefs.some(
        (entry) =>
          entry.key === v789gCategory
      )
    ) {
      return;
    }

    const fallbackCategory: V789gCategoryKey =
      v789gVisibleCategoryDefs.some(
        (entry) =>
          entry.key === 'us'
      )
        ? 'us'
        : v789gVisibleCategoryDefs[0].key;

    setV789gCategory(
      fallbackCategory
    );

    const fallbackIndex =
      v789gVisibleCategoryDefs.findIndex(
        (entry) =>
          entry.key === fallbackCategory
      );

    setV789nNativeCategoryPreferredIndex(
      Math.max(
        0,
        fallbackIndex
      )
    );
  }, [
    v789gCategory,
    v789gVisibleCategoryDefs,
  ]);
  // Existing native guide event
  // dispatcher reads this ref.
  // Keep it synchronized with
  // the filtered guide row count.
  v788t8cChannelCountRef.current =
    v789gVisibleChannels.length;

  // V789N_NATIVE_CATEGORY_ENTRY
  const v789gOpenCategoriesFromChannel =
    useCallback(
      (channel: GuideChannel) => {
        setV789gFavoriteActionChannel(
          channel
        );

        // V789S9_CATEGORY_ENTRY_CANCELS_STALE_LEFT
        // Never allow a previously armed single-LEFT tray timer to fire after
        // Categories has legitimately taken focus.
        if (
          v789kSingleLeftTimerRef.current
        ) {
          clearTimeout(
            v789kSingleLeftTimerRef.current
          );

          v789kSingleLeftTimerRef.current =
            null;
        }

        v788t8cFirstLeftRef.current =
          0;

        v788t8cRawLeftRef.current =
          0;

        v789s9ProgramToStationLeftRef.current =
          0;

        v789hCategoryFocusedIndexRef
          .current = -1;

        v789mCategoryExitPendingRef.current =
          false;

        // V789S9_CATEGORY_OWNS_FOCUS
        // While Categories is active, a category change may remount/update the
        // native guide underneath it. Put the guide's preferred focus in the
        // existing -1 sentinel state and clear any old restore request so that
        // those data changes cannot steal Android focus from Categories.
        setPreferredChannelIndex(
          -1
        );

        setV788t8vFocusRestoreRequest({
          index: -1,
          serial: 0,
        });

        const selectedIndex =
          Math.max(
            0,
            v789gVisibleCategoryDefsRef.current.findIndex(
              (entry) =>
                entry.key ===
                v789gCategory
            )
          );

        console.log(
          '[V789N NATIVE CATEGORY ENTER] ' +
            'channel=' +
            channel.key +
            ' category=' +
            v789gCategory +
            ' index=' +
            selectedIndex
        );

        setV789nNativeCategoryPreferredIndex(
          selectedIndex
        );

        v789hCategoryModeRef.current =
          true;

        setV789hCategoryMode(
          true
        );

        setV789nNativeCategoryFocusSerial(
          (value) => value + 1
        );
      },
      [
        v789gCategory,
        v789gVisibleCategoryDefs,
      ]
    );

  // V789S9_CATEGORY_SELECT_STAYS_ON_RAIL
  const v789gSelectCategory =
    useCallback(
      (
        category:
          V789gCategoryKey
      ) => {
        // OK means SELECT only. It updates the committed filter but Categories
        // remains the Android focus owner until the user explicitly presses DOWN.
        v789hCategoryModeRef.current =
          true;

        setV789hCategoryMode(
          true
        );

        v789mCategoryExitPendingRef.current =
          false;

        if (
          category ===
          v789gCategory
        ) {
          console.log(
            '[V789S9 CATEGORY SELECT STAY] ' +
              'key=' +
              category +
              ' changed=false'
          );

          return;
        }

        setV789gCategory(
          category
        );

        console.log(
          '[V789S9 CATEGORY SELECT STAY] ' +
            'key=' +
            category +
            ' changed=true'
        );
      },
      [
        v789gCategory,
        v789gVisibleCategoryDefs,
      ]
    );
  // V788T8ZA_STICKY_CONFIRMED_BOOKMARK
  //
  // A bookmark override is no longer merely temporary.
  // Once the API/library confirms it, keep that exact value
  // authoritative for this mounted Live TV screen.
  //
  // This prevents unrelated/concurrent library refreshes from
  // visually reverting a bookmark while rows are recycled.
  // A full Live TV remount/app restart still initializes from
  // the persisted library returned by the server.

  const loadGuide = useCallback(async (silent = false) => {
    // V785A_LIVE_GUIDE_PERSIST
    if (guideLoadInFlightRef.current) {
      console.log('[V785A LIVE GUIDE] load already in flight - reuse current guide');
      return;
    }

    guideLoadInFlightRef.current = true;

    const generation = ++loadGenerationRef.current;

    const w121zlive122Controller =
      new AbortController();

    w121zlive122GuideAbortRef.current =
      w121zlive122Controller;

    const w121zlive122Signal =
      w121zlive122Controller.signal;

    // Only show the full guide loader when we truly have no guide yet.
    if (!silent && !guideLoadedRef.current) {
      setLoading(true);
    }

    try {
      // W121ZEPG161B: rehydrate only a recent, complete snapshot from the
      // identical account and installed-addon inventory. Never use a cache
      // on an unknown account, incomplete addon state, or cancelled focus.
      if (!guideLoadedRef.current && !silent) {
        try {
          const w161gCacheStart = Date.now();
          const w161gState = useContentStore.getState();
          const w161gUidReady = !!String(w161gState.currentUserId || '').trim();
          const w161gAddons = Array.isArray(w161gState.addons) ? w161gState.addons : [];
          // W121ZEPG161S-R2: During cold launch, wait briefly for account/addon
          // scope readiness before deciding a valid display snapshot is unusable.
          // Existing post-read scope recheck remains the authority.
          let scope = w161bScope();
          let w161sReadyRetries = 0;
          while (!scope && w161sReadyRetries < 6 &&
                 generation === loadGenerationRef.current &&
                 !w121zlive122Signal.aborted && !guideLoadedRef.current) {
            await new Promise<void>((resolve) => setTimeout(resolve, 200));
            scope = w161bScope();
            w161sReadyRetries++;
          }
          console.log('[W121ZEPG161S-R2 CACHE] scope readiness',
            'ready=' + !!scope, 'retries=' + w161sReadyRetries);
          console.log('[W121ZEPG161G CACHE] restore attempt',
            'uidReady=' + w161gUidReady,
            'addonsLoading=' + !!w161gState.isLoadingAddons,
            'addonCount=' + w161gAddons.length,
            'scopeReady=' + !!scope);
          if (scope) {
            const raw = await W121zEpg161bStorage.getItem(W161B_CACHE_KEY);
            // Bound parsing work and memory before deserializing any cache payload.
            const snapshot = raw && raw.length <= W161D_MAX_CACHE_BYTES
              ? JSON.parse(raw) : null;
            const rows = snapshot?.channels;
            const valid = snapshot?.schema === 1 &&
              snapshot?.scope === scope &&
              snapshot?.compact === true &&
              Number.isFinite(snapshot?.savedAt) &&
              Date.now() - snapshot.savedAt >= 0 &&
              Date.now() - snapshot.savedAt <= W161B_MAX_AGE_MS &&
              Array.isArray(rows) && rows.length >= 1 &&
              rows.length <= W161B_MAX_ROWS &&
              rows.every((row: any) =>
                // Some legitimate stations have no channel-level addonId.
                // The snapshot's entire addon inventory is already scope-matched.
                !!String(row?.key || '').trim() &&
                !!String(row?.name || '').trim() &&
                !!String(row?.item?.id || '').trim() &&
                Array.isArray(row?.programs) && row.programs.length === 0);
            // W121ZEPG161K: log the exact reason for a rejected cached guide.
            // Diagnostics only: do not alter the admission predicate.
            const w161kBadRows = Array.isArray(rows) ? rows.reduce((totals: any, row: any) => {
              if (!String(row?.key || '').trim()) totals.key++;
              if (!String(row?.name || '').trim()) totals.name++;
              if (!String(row?.item?.id || '').trim()) totals.itemId++;
              if (!Array.isArray(row?.programs) || row.programs.length !== 0) totals.programs++;
              return totals;
            }, { key: 0, name: 0, itemId: 0, programs: 0 }) : null;
            const w161kGenerationOK = generation === loadGenerationRef.current;
            const w161kAbortOK = !w121zlive122Signal.aborted;
            // W121ZEPG161L: addon scope can change while async storage reads.
            // Briefly allow it to settle, but NEVER accept a different account/addon scope.
            let w161lScopeNow = w161bScope();
            let w161lRetryCount = 0;
            while (valid && w161lScopeNow !== scope && w161lRetryCount < 5 &&
                   generation === loadGenerationRef.current &&
                   !w121zlive122Signal.aborted && !guideLoadedRef.current) {
              await new Promise<void>((resolve) => setTimeout(resolve, 200));
              w161lScopeNow = w161bScope();
              w161lRetryCount++;
            }
            const w161kScopeStable = scope === w161lScopeNow;
            console.log('[W121ZEPG161L CACHE] scope recheck',
              'sameScope=' + w161kScopeStable,
              'retries=' + w161lRetryCount,
              'currentReady=' + !!w161lScopeNow);
            console.log('[W121ZEPG161K CACHE] decision',
              'valid=' + valid,
              'invalidRows=' + JSON.stringify(w161kBadRows),
              'generationOK=' + w161kGenerationOK,
              'signalOK=' + w161kAbortOK,
              'scopeStable=' + w161kScopeStable,
              'count=' + (Array.isArray(rows) ? rows.length : -1));
            if (valid && w161kGenerationOK &&
                w161kAbortOK && w161kScopeStable) {
              // Cache is presentation-only; authoritative refresh continues.
              // W121ZEPG161AM: paint cached current/upcoming programs with
              // cached channels; never use a schedule from another addon scope.
              let w161amRows = rows as GuideChannel[];
              try {
                const w161amRaw = await W121zEpg161bStorage.getItem(W161AM_PROGRAM_KEY);
                if (w161amRaw && w161amRaw.length <= W161AM_PROGRAM_MAX_BYTES) {
                  const w161amData = JSON.parse(w161amRaw);
                  const w161amNow = Date.now();
                  if (w161amData?.schema === 1 &&
                      w161amData?.scope === scope &&
                      Number.isFinite(w161amData?.savedAt) &&
                      w161amNow >= w161amData.savedAt &&
                      w161amNow - w161amData.savedAt <= W161AM_PROGRAM_AGE_MS &&
                      Array.isArray(w161amData?.entries) &&
                      w161amData.entries.length <= W161B_MAX_ROWS &&
                      w161bScope() === scope &&
                      generation === loadGenerationRef.current &&
                      !w121zlive122Signal.aborted) {
                    const w161amByKey = new Map<string, GuideProgram[]>();
                    for (const entry of w161amData.entries) {
                      if (typeof entry?.key !== 'string' ||
                          !Array.isArray(entry?.programs) || entry.programs.length > 5) continue;
                      const p = entry.programs.filter((x: any) =>
                        typeof x?.title === 'string' && x.title.length <= 240 &&
                        Number.isFinite(Date.parse(x?.startTime)) &&
                        Number.isFinite(Date.parse(x?.endTime)) &&
                        Date.parse(x.endTime) > w161amNow);
                      if (p.length) w161amByKey.set(entry.key, p);
                    }
                    w161amRows = w161amRows.map((row) => ({
                      ...row, programs: w161amByKey.get(row.key) || [],
                    }));
                    console.log('[W121ZEPG161AM EPG] cached schedules restored',
                      'matched=' + w161amRows.filter((x) => x.programs.length > 0).length);
                  }
                }
              } catch (w161amError) {
                console.warn('[W121ZEPG161AM EPG] schedule restore skipped', w161amError);
              }
              setChannels(w161amRows);
              guideLoadedRef.current = true;
              setLoading(false);
              console.log('[W121ZEPG161G CACHE] HIT rows=' + rows.length +
                ' restoreMs=' + (Date.now() - w161gCacheStart));
              // W121ZEPG161AI: The compact cache deliberately has programs: [].
              // Show cached stations immediately, then recover current EPG data.
              // Do not let a cache HIT indefinitely suppress authoritative EPG.
              console.log('[W121ZEPG161AI EPG] cached stations displayed; authoritative refresh scheduled');
              await new Promise<void>((resolve) => setTimeout(resolve, 1800));
              if (generation !== loadGenerationRef.current || w121zlive122Signal.aborted) {
                console.log('[W121ZEPG161AI EPG] background refresh cancelled');
                return;
              }
              console.log('[W121ZEPG161AI EPG] authoritative inventory and EPG refresh starting');
            } else {
              console.log('[W121ZEPG161G CACHE] MISS',
                'present=' + !!raw,
                'bytes=' + (raw ? raw.length : 0),
                'schemaOK=' + (snapshot?.schema === 1),
                'scopeOK=' + (snapshot?.scope === scope),
                'compactOK=' + (snapshot?.compact === true),
                'ageMs=' + (Number.isFinite(snapshot?.savedAt) ? Date.now() - snapshot.savedAt : -1),
                'rows=' + (Array.isArray(rows) ? rows.length : -1),
                'restoreMs=' + (Date.now() - w161gCacheStart));
            }
          } else {
            console.log('[W121ZEPG161G CACHE] SKIP scope-not-ready',
              'restoreMs=' + (Date.now() - w161gCacheStart));
          }
        } catch (cacheError) {
          console.warn('[W121ZEPG161B CACHE] read failed', cacheError);
        }
      }

      const date = localDateKey(new Date());

      // BU23OH: identical admission/enrichment for partial and final guide rows.
      const buildPlayableRows = (inventoryItems: any[], epgByIdentity: Map<string, any>,
        enrichmentByIdentity: Map<string, GuideChannel>) => {
        const playableByIdentity =
          new Map<string, GuideChannel>();

        // W121ZEPG151C - audited, exact 3ABN feed identities only.
        const w151cStremTvLogoByChannel: Record<string, string> = {
          'stremtv-us:DareToDreamNetwork.us': 'https://i.imgur.com/oNUpXA9.png',
          'stremtv-us:3ABNEnglish.us': 'https://i.imgur.com/16DMxP4.png',
          'stremtv-us:3ABNFrench.us': 'https://i.imgur.com/B5gsM7m.png',
          'stremtv-us:3ABNInternational.us': 'https://i.imgur.com/IecOZHR.png',
          'stremtv-us:3ABNKids.us': 'https://i.imgur.com/z3npqO1.png',
          'stremtv-us:3ABNLatino.us': 'https://i.imgur.com/Ugb4AFo.png',
          'stremtv-us:3ABNPraiseHimMusicNetwork.us': 'https://i.imgur.com/iBcqT8L.png',
          'stremtv-us:3ABNProclaimNetwork.us': 'https://i.imgur.com/zUMUNhe.png',
        };

        for (const raw of inventoryItems) {
          // W121ZLIVE172F: discard NexoTV's synthetic HTTP-200 rate-limit item.
          if (String((raw as any)?.imdb_id || (raw as any)?.id || '')
                .trim().toLowerCase() === 'ratelimit_error') {
            console.warn('[W121ZLIVE172F] ignored synthetic catalog rate-limit row');
            continue;
          }
          const id =
            String(
              (raw as any)?.imdb_id ||
              (raw as any)?.id ||
              ''
            ).trim();

          const addonId =
            String(
              (raw as any)?.addonId ||
              (raw as any)?._addon_id ||
              ''
            ).trim();

          if (!id || !addonId) {
            continue;
          }

          const identity =
            `${addonId}:${id}`;

          const existing =
            enrichmentByIdentity.get(identity);

          const epg =
            epgByIdentity.get(identity);

          // W121ZEPG151C_STREMTV_LOGO_RECOVERY
          // The channel inventory, streams and EPG identities remain unchanged.
          // StremTV US supplies poster artwork but no dedicated `logo` property.
          // Use an exact-identity known station logo where verified. Otherwise,
          // reuse the channel's *own* supplied poster only when the provider and
          // native EPG have not already supplied an explicit station logo.
          const w151cFromStremTv = addonId === 'com.stremtv.us';
          const w151cSuppliedPoster = String((raw as any)?.poster || '').trim();
          const w151cProviderPosterLogo =
            w151cFromStremTv && /^https?:\/\//i.test(w151cSuppliedPoster)
              ? w151cSuppliedPoster : '';
          // W121ZLIVE172C NEXOTV REAL STATION ARTWORK
          // NexoTV publishes channel logos as catalog `poster`, not `logo`.
          // Its missing-logo fallback uses placehold.co with channel text: never
          // pass those generated letter tiles to the native station guide.
          const w172cIsNexoTv = addonId === 'community.nexotv';
          const w172cNexoPoster = String((raw as any)?.poster || '').trim();
          const w172cNexoLogo =
            /^https?:\/\//i.test(w172cNexoPoster) &&
            !/^https?:\/\/(?:www\.)?placehold\.co\//i.test(w172cNexoPoster)
              ? w172cNexoPoster : '';
          const stationLogo = w172cIsNexoTv
            ? w172cNexoLogo
            : String(
                epg?.logo ||
                (raw as any)?.logo ||
                existing?.logo ||
                (w151cFromStremTv
                  ? (w151cStremTvLogoByChannel[id] || w151cProviderPosterLogo)
                  : '') ||
                ''
              ).trim();

          const name =
            String(
              (raw as any)?.name ||
              epg?.name ||
              existing?.name ||
              id
            );

          // W121ZEPG177D: do not replace a populated cached schedule with
          // an empty/incomplete EPG response during guide refresh.
          const programs =
            Array.isArray(epg?.programs) && epg.programs.length > 0
              ? epg.programs
              : (
                  Array.isArray(existing?.programs)
                    ? existing!.programs
                    : []
                );

          playableByIdentity.set(
            identity,
            {
              key:
                String(
                  existing?.key ||
                  identity
                ),

              item: {
                ...(existing?.item || {}),
                ...(raw as any),
                id,
                type: 'tv',
                name,
                poster: stationLogo,
              },

              name,
              logo: stationLogo,

              sourceName:
                String(
                  (raw as any)?.sourceName ||
                  existing?.sourceName ||
                  ''
                ),

              addonId,
              programs,
            }
          );
        }
        return playableByIdentity;
      };
      const bu23ohScope = w161bScope();
      const bu23ohCold = !guideLoadedRef.current && !silent;
      let bu23ohPainted = false;
      let bu23ohLastCount = 0;
      const bu23ohEpg = new Map<string, any>();
      const bu23ohCanPaint = () => bu23ohCold && !!bu23ohScope &&
        w161bScope() === bu23ohScope && generation === loadGenerationRef.current &&
        !w121zlive122Signal.aborted && w121zlive123ScreenFocusedRef.current;
      const bu23ohPaint = (items: any[], stage: string) => {
        if (!bu23ohCanPaint() || !items.length || items.length === bu23ohLastCount) return;
        const rows = Array.from(buildPlayableRows(items, bu23ohEpg, new Map<string, GuideChannel>()).values());
        if (!rows.length) return;
        rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined,
          { sensitivity: 'base', numeric: true }));
        if (!bu23ohCanPaint()) return;
        setChannels(rows);
        guideLoadedRef.current = true;
        lastGuideLoadAtRef.current = Date.now();
        setLoading(false);
        bu23ohPainted = true;
        bu23ohLastCount = items.length;
        console.log('[BU23OH EARLY GUIDE]', 'stage=' + stage, 'channels=' + rows.length,
          'authoritative=false', 'nativePendingNotAdmitted=true');
      };


      // V788T12K_PARALLEL_EPG_INVENTORY
      //
      // Run the complete provider-neutral playable-channel inventory
      // concurrently with Discover + EPG.
      //
      // Nothing is rendered to the guide until ALL work reaches the
      // final barrier and one stable dataset is committed.

      const v788t12kInventoryPromise =
        (async () => {
          let sourceIndex = 0;
          let skip = 0;
          let completed = false;

          let pageCount = 0;
          let scannedTotal = 0;
          let playableTotal = 0;
          let deviceCheckTotal = 0;
          let emptyTotal = 0;
          let unknownTotal = 0;
          // W121ZLIVE173C: NexoTV returns synthetic rate-limit catalog items
          // as HTTP-200 success; bound repeated fake pages without changing
          // stream resolution, genuine station identities or EPG.
          let w173cFakePageStreak = 0;
          let w175aNexoRateLimited = false;

          const rawPlayable: any[] = [];
          const rawDeviceCheck: any[] = [];

          const visitedCursors =
            new Set<string>();

          console.log(
            '[V788T12K LIVE INVENTORY] parallel start',
            'generation=' + generation
          );

          while (
            generation ===
            loadGenerationRef.current
          ) {
            const cursor =
              `${sourceIndex}:${skip}`;

            if (visitedCursors.has(cursor)) {
              throw new Error(
                '[V788T12K LIVE INVENTORY] repeated cursor ' +
                  cursor
              );
            }

            visitedCursors.add(cursor);

            let page: any = null;
            let lastPageError: any = null;

            for (
              let pageAttempt = 1;
              pageAttempt <= 3;
              pageAttempt += 1
            ) {
              try {
                page =
                  await api.content.getLiveTvInventoryPage(
                    sourceIndex,
                    skip,
                    400,
                    w121zlive122Signal
                  );

                lastPageError = null;
                break;
              } catch (error) {
                lastPageError = error;

                if (
                  w121zlive122Signal.aborted ||
                  generation !==
                    loadGenerationRef.current
                ) {
                  console.log(
                    '[W121ZLIVE122 LIVE LOAD CANCEL]',
                    'stage=inventory-page',
                    'generation=' + generation,
                    'source=' + sourceIndex,
                    'skip=' + skip
                  );

                  throw error;
                }

                console.warn(
                  '[V788T12K LIVE INVENTORY] page retry',
                  'source=' + sourceIndex,
                  'skip=' + skip,
                  'attempt=' + pageAttempt,
                  error
                );

                if (pageAttempt < 3) {
                  await new Promise<void>(
                    (resolve) =>
                      setTimeout(
                        resolve,
                        500 * pageAttempt
                      )
                  );
                }
              }
            }

            if (page == null) {
              throw (
                lastPageError ||
                new Error(
                  '[V788T12K LIVE INVENTORY] page unavailable'
                )
              );
            }

            if (
              generation !==
              loadGenerationRef.current
            ) {
              return {
                superseded: true,
                items: [] as any[],
                pageCount,
                scannedTotal,
                playableTotal,
                emptyTotal,
                unknownTotal,
                nexoRateLimited: w175aNexoRateLimited,
              };
            }

            if (page?.catalogDeferred === true && page?.source?.addonId === 'community.nexotv') {
              w175aNexoRateLimited = true;
            }

            const pageItems =
              Array.isArray(page?.items)
                ? page.items
                : [];

            const pageDeviceCheckItems =
              Array.isArray(page?.deviceCheckItems)
                ? page.deviceCheckItems
                : [];

            // W121ZLIVE173C: the NexoTV public server returns a single
            // `ratelimit_error` pseudo-channel instead of a proper error.
            // After repeated *consecutive* verified fake pages, preserve
            // every real row already collected and move past only that
            // failing source. This prevents hundreds of wasted requests.
            const w173cIsFakeNexoPage =
              pageItems.length > 0 &&
              pageDeviceCheckItems.length === 0 &&
              pageItems.every((item: any) =>
                String(item?.addonId || item?._addon_id || '').trim().toLowerCase() === 'community.nexotv' &&
                String(item?.imdb_id || item?.id || '').trim().toLowerCase() === 'ratelimit_error'
              );
            w173cFakePageStreak = w173cIsFakeNexoPage
              ? w173cFakePageStreak + 1
              : 0;
            if (w173cFakePageStreak >= 8) {
              w175aNexoRateLimited = true;
              const w173cSourceCount = Number(page?.sourceCount);
              if (!Number.isInteger(w173cSourceCount) ||
                  w173cSourceCount <= sourceIndex ||
                  w173cSourceCount > 100) {
                throw new Error('[W121ZLIVE173C] invalid source count on synthetic response');
              }
              console.warn(
                '[W121ZLIVE173C] bounded synthetic NexoTV pages',
                'source=' + sourceIndex,
                'skip=' + skip,
                'realRowsKept=' + rawPlayable.length,
                'sourceCount=' + w173cSourceCount
              );
              w173cFakePageStreak = 0;
              if (sourceIndex + 1 >= w173cSourceCount) {
                completed = true;
                break;
              }
              sourceIndex += 1;
              skip = 0;
              continue;
            }
            rawPlayable.push(
              ...pageItems
            );

            rawDeviceCheck.push(
              ...pageDeviceCheckItems
            );

            pageCount += 1;

            scannedTotal +=
              Number(page?.scanned || 0);

            playableTotal +=
              Number(page?.playable || 0);

            deviceCheckTotal +=
              Number(page?.deviceCheck || 0);

            emptyTotal +=
              Number(page?.hiddenNoStream || 0);

            unknownTotal +=
              Number(page?.unknown || 0);

            console.log(
              '[V788T12K LIVE INVENTORY] page',
              'source=' + sourceIndex,
              'skip=' + skip,
              'scanned=' + String(page?.scanned ?? ''),
              'playable=' + String(page?.playable ?? ''),
              'empty=' + String(page?.hiddenNoStream ?? ''),
              'unknown=' + String(page?.unknown ?? ''),
              'received=' + pageItems.length,
              'done=' + String(Boolean(page?.done))
            );

            // The backend-positive rows are the same inputs used by final admission.
            // Do not expose rawDeviceCheck candidates or publish partial addon counts.
            if (!bu23ohPainted || page?.done === true ||
                (Number.isInteger(Number(page?.nextSourceIndex)) && Number(page?.nextSourceIndex) !== sourceIndex)) {
              bu23ohPaint(rawPlayable, 'inventory-page');
            }

            if (page?.done === true) {
              completed = true;

              console.log(
                '[V788T12K LIVE INVENTORY] natural exhaustion',
                'raw=' + rawPlayable.length,
                'pages=' + pageCount
              );

              break;
            }

            const nextSourceIndex =
              Number(page?.nextSourceIndex);

            const nextSkip =
              Number(page?.nextSkip);

            if (
              !Number.isInteger(nextSourceIndex) ||
              nextSourceIndex < 0 ||
              !Number.isInteger(nextSkip) ||
              nextSkip < 0
            ) {
              throw new Error(
                '[V788T12K LIVE INVENTORY] invalid cursor ' +
                  String(page?.nextSourceIndex) +
                  ':' +
                  String(page?.nextSkip)
              );
            }

            const nextCursor =
              `${nextSourceIndex}:${nextSkip}`;

            if (nextCursor === cursor) {
              throw new Error(
                '[V788T12K LIVE INVENTORY] no cursor progress ' +
                  cursor
              );
            }

            sourceIndex =
              nextSourceIndex;

            skip =
              nextSkip;

            await new Promise<void>(
              (resolve) =>
                setTimeout(
                  resolve,
                  40
                )
            );
          }

          if (
            generation !==
            loadGenerationRef.current
          ) {
            return {
              superseded: true,
              items: [] as any[],
              pageCount,
              scannedTotal,
              playableTotal,
              emptyTotal,
              unknownTotal,
              nexoRateLimited: w175aNexoRateLimited,
            };
          }

          if (!completed) {
            throw new Error(
              '[V788T12K LIVE INVENTORY] did not reach natural exhaustion'
            );
          }

          return {
            superseded: false,
            items: rawPlayable,
            deviceCheckItems: rawDeviceCheck,
            pageCount,
            scannedTotal,
            playableTotal,
            deviceCheckTotal,
            emptyTotal,
            unknownTotal,
            nexoRateLimited: w175aNexoRateLimited,
          };
        })();

      // W121ZOD49A_LIVE_TV_DISCOVER_BYPASS
      //
      // Live TV membership comes from the playable inventory.
      // EPG provides schedule/logo enrichment.
      // Discover must not block guide startup.
      // W121ZEPG171I: hydrate the already-displayed, account-scoped guide
      // from a successful EPG response WITHOUT waiting for every inventory
      // page. The authoritative inventory+EPG barrier below stays intact.
      // Only exact addon/channel identities can receive a schedule.
      const w171iEpgPromise = api.content.getLiveTvEpg(
        date,
        w121zlive122Signal
      );
      void w171iEpgPromise.then((epgPayload: any) => {
        if (bu23ohCanPaint()) {
          for (const provider of (Array.isArray(epgPayload?.providers) ? epgPayload.providers : [])) {
            const addonId = String(provider?.addonId || '').trim();
            if (!addonId) continue;
            for (const channel of (Array.isArray(provider?.channels) ? provider.channels : [])) {
              const id = String(channel?.id || '').trim();
              if (!id) continue;
              const key = `${addonId}:${id}`;
              const prior = bu23ohEpg.get(key);
              if (!prior || (Array.isArray(channel?.programs) && channel.programs.length > (prior.programs?.length || 0))) {
                bu23ohEpg.set(key, { ...channel, addonId, sourceName: provider?.addonName || provider?.catalogName || '' });
              }
            }
          }
        }
        if (
          generation !== loadGenerationRef.current ||
          w121zlive122Signal.aborted ||
          !guideLoadedRef.current
        ) return;
        const schedules = new Map<string, GuideProgram[]>();
        for (const provider of (Array.isArray(epgPayload?.providers) ? epgPayload.providers : [])) {
          const addonId = String(provider?.addonId || '').trim();
          if (!addonId) continue;
          for (const channel of (Array.isArray(provider?.channels) ? provider.channels : [])) {
            const id = String(channel?.id || '').trim();
            if (!id) continue;
            const programs: GuideProgram[] =
              (Array.isArray(channel?.programs) ? channel.programs : []).filter((p: any) => {
                const start = Date.parse(String(p?.startTime || ''));
                const end = Date.parse(String(p?.endTime || ''));
                return Number.isFinite(start) && Number.isFinite(end) && end > start;
              });
            if (!programs.length) continue;
            const identity = `${addonId}:${id}`;
            const previous = schedules.get(identity);
            if (!previous || programs.length > previous.length) {
              schedules.set(identity, programs);
            }
          }
        }
        if (!schedules.size) return;
        setChannels((current) => {
          if (generation !== loadGenerationRef.current || w121zlive122Signal.aborted) {
            return current;
          }
          let updated = 0;
          let buzzrPrograms = -1;
          const next = current.map((channel) => {
            const identity = `${String(channel.addonId || '').trim()}:${String(channel.item?.id || channel.item?.imdb_id || '').trim()}`;
            const schedule = schedules.get(identity);
            if (!schedule) return channel;
            if (identity === 'community.usa-tv-next:ustv-6ef7f0e8-ff2a-4df3-9069-db53ace915a1') {
              buzzrPrograms = schedule.length;
            }
            const existing = channel.programs || [];
            if (existing.length === schedule.length &&
                existing[0]?.startTime === schedule[0]?.startTime &&
                existing[existing.length - 1]?.endTime === schedule[schedule.length - 1]?.endTime) {
              return channel;
            }
            updated += 1;
            return { ...channel, programs: schedule };
          });
          console.log('[W121ZEPG171I EPG FIRST]',
            'matchedChannels=' + updated,
            'buzzrPrograms=' + buzzrPrograms,
            'inventoryWaiting=true');
          return updated ? next : current;
        });
      }).catch((error: any) => {
        if (!w121zlive122Signal.aborted) {
          console.warn('[W121ZEPG171I EPG FIRST] request unavailable', String(error?.message || error));
        }
      });
      const [
        epgResult,
        inventoryResult,
      ] = await Promise.allSettled([
        w171iEpgPromise,
        v788t12kInventoryPromise,
      ]);

      console.log(
        '[W121ZOD49A LIVE LOAD] guide barrier complete',
        'epg=' + epgResult.status,
        'inventory=' + inventoryResult.status
      );

      // W121ZLIVE147B: EPG channel IDs are not globally unique. Scope every
      // schedule/logo to the *owning addon*; do not cross-wire programs to a
      // similarly named or identically numbered station in another addon.
      const epgByIdentity = new Map<string, any>();

      if (epgResult.status === 'fulfilled') {
        for (const provider of epgResult.value?.providers || []) {
          const providerAddonId = String(provider?.addonId || '').trim();
          if (!providerAddonId) continue;
          for (const channel of provider?.channels || []) {
            const id = String(channel?.id || '').trim();
            if (!id) continue;

            const enriched = {
              ...channel,
              sourceName: provider?.addonName || provider?.catalogName || '',
              addonId: providerAddonId,
            };
            const epgIdentity = `${providerAddonId}:${id}`;
            const prior = epgByIdentity.get(epgIdentity);
            if (!prior || (Array.isArray(enriched.programs) &&
              enriched.programs.length > (prior.programs?.length || 0))) {
              epgByIdentity.set(epgIdentity, enriched);
            }
          }
        }
      } else {
        console.warn('[V784J_EPG] unavailable', epgResult.reason);
      }

      // W121ZOD49A_NO_DISCOVER_ENRICHMENT
      //
      // Inventory + EPG already provide every field required by
      // the authoritative final merge below.
      const next: GuideChannel[] = [];

      // V788T16F_INVENTORY_OWNS_GUIDE_MEMBERSHIP
      //
      // EPG is enrichment only.
      //
      // A schedule provider must never create a Live TV row by itself.
      // Channel membership comes exclusively from the completed playable
      // inventory. If inventory removes a channel because its owning addon
      // has no usable stream, EPG cannot reinsert that channel.

      if (generation !== loadGenerationRef.current) return;
      // V784O_LIVE_TV_AZ
      next.sort((a, b) =>
        String(a.name || '').localeCompare(
          String(b.name || ''),
          undefined,
          {
            sensitivity: 'base',
            numeric: true,
          }
        )
      );

      // V788T12K_PARALLEL_STABLE_GUIDE_COMMIT
      //
      // EPG and the COMPLETE playable inventory have now
      // reached the same barrier.
      //
      // Inventory controls visibility.
      // EPG enriches verified playable channels only.
      // Native guide receives ONE final stable array.

      if (
        generation !==
        loadGenerationRef.current
      ) {
        return;
      }

      if (
        inventoryResult.status !== 'fulfilled'
      ) {
        throw inventoryResult.reason;
      }

      const inventoryPayload =
        inventoryResult.value;

      if (inventoryPayload?.superseded) {
        return;
      }

      const backendPlayableItems =
        Array.isArray(inventoryPayload?.items)
          ? inventoryPayload.items
          : [];

      const deviceCheckItems =
        Array.isArray(
          inventoryPayload?.deviceCheckItems
        )
          ? inventoryPayload.deviceCheckItems
          : [];

      bu23ohPaint(backendPlayableItems, 'inventory-complete');

      let v788t16jDevicePassedCount = 0;
      let v788t16jDeviceRejectedCount = 0;
      let v788t16jDevicePendingCount = 0;

      const v788t16jDevicePassedItems: any[] = [];

      if (deviceCheckItems.length > 0) {
        const candidateRows: any[] = [];

        for (const raw of deviceCheckItems) {
          const id =
            String(raw?.id || '').trim();

          const addonId =
            String(raw?.addonId || '').trim();

          if (!id || !addonId) {
            continue;
          }

          const identity =
            addonId + ':' + id;

          const streams =
            Array.isArray(
              raw?.deviceCheckStreams
            )
              ? raw.deviceCheckStreams
              : [];

          for (
            const stream of streams.slice(0, 4)
          ) {
            const url =
              String(stream?.url || '').trim();

            if (!url) continue;

            candidateRows.push({
              key: identity,
              url,
              headers:
                stream?.headers &&
                typeof stream.headers ===
                  'object'
                  ? stream.headers
                  : {},
            });
          }
        }

        try {
          const {
            probeLiveTvDeviceCandidates,
          } = require(
            '../../src/native/devicePlaybackCapabilities'
          );

          // BU23MP: native accepts at most 512 rows and 256 identities.
          // Keep all alternatives for each identity in the same bounded batch.
          const groups = new Map<string, any[]>();
          for (const row of candidateRows) {
            const group = groups.get(row.key) || [];
            group.push(row);
            groups.set(row.key, group);
          }
          const batches: any[][] = [];
          let batch: any[] = [];
          let identities = 0;
          for (const rows of groups.values()) {
            if (rows.length > 4) {
              // Do not claim terminal proof from a truncated set of alternatives.
              console.warn('[BU23MP PREFLIGHT] oversized identity deferred');
              continue;
            }
            if (identities >= 96 || batch.length + rows.length > 384) {
              batches.push(batch);
              batch = [];
              identities = 0;
            }
            batch.push(...rows);
            identities++;
          }
          if (batch.length) batches.push(batch);
          const passed = new Set<string>();
          const terminal = new Set<string>();
          for (let index = 0; index < batches.length; index++) {
            if (generation !== loadGenerationRef.current || w121zlive122Signal.aborted) return;
            const allowed = new Set(batches[index].map(row => String(row.key)));
            try {
              const result = await probeLiveTvDeviceCandidates(batches[index], 2500);
              if (generation !== loadGenerationRef.current || w121zlive122Signal.aborted) return;
              // BU23MZ: report targeted verification outcomes only.
              for (const raw of deviceCheckItems) {
                const name = String(raw?.name || '').trim();
                const addon = String(raw?.addonId || '').trim();
                if (addon !== 'community.nexotv') continue;
                if (!/^(13 Kids|7mate|24 Kanal)$/i.test(name)) continue;

                const key = addon + ':' + String(raw?.id || '').trim();
                if (!allowed.has(key)) continue;

                const detail = (result as any)?.results?.[key];
                console.log('[BU23MZ TARGET PROBE]',
                  'channel=' + name,
                  'reason=' + String(detail?.reason || 'missing_result'),
                  'playable=' + String(detail?.playable === true),
                  'terminal=' + String(detail?.terminalMissing === true));
              }
              for (const key of (Array.isArray(result?.playableKeys) ? result.playableKeys : [])) {
                if (allowed.has(String(key))) passed.add(String(key));
              }
              for (const key of (Array.isArray(result?.terminalFailedKeys) ? result.terminalFailedKeys : [])) {
                if (allowed.has(String(key))) terminal.add(String(key));
              }
              console.log('[BU23MP PREFLIGHT BATCH]', 'batch=' + (index + 1) + '/' + batches.length,
                'identities=' + allowed.size, 'checked=' + Number(result?.checked || 0),
                'passed=' + passed.size, 'terminal=' + terminal.size);
            } catch (error) {
              // Retain positive results so far; leave all remaining identities pending.
              console.warn('[BU23MP PREFLIGHT] batch deferred', index + 1, String(error));
              break;
            }
          }
          const probeResult = { playableKeys: Array.from(passed) };

          if (
            generation !==
            loadGenerationRef.current
          ) {
            return;
          }

          const playableKeys =
            new Set<string>(
              (
                Array.isArray(
                  probeResult?.playableKeys
                )
                  ? probeResult.playableKeys
                  : []
              ).map(
                (value: any) =>
                  String(value || '')
              )
            );

          for (const raw of deviceCheckItems) {
            const id =
              String(raw?.id || '').trim();

            const addonId =
              String(
                raw?.addonId || ''
              ).trim();

            const identity =
              addonId && id
                ? addonId + ':' + id
                : '';

            if (
              !identity ||
              !playableKeys.has(identity)
            ) {
              continue;
            }

            const clean = {
              ...(raw as any),
            };

            delete (
              clean as any
            ).deviceCheckStreams;

            v788t16jDevicePassedItems.push(
              clean
            );
          }

          v788t16jDevicePassedCount =
            v788t16jDevicePassedItems.length;

          v788t16jDeviceRejectedCount = deviceCheckItems.filter((raw: any) => {
            const key = String(raw?.addonId || '').trim() + ':' + String(raw?.id || '').trim();
            return terminal.has(key) && !passed.has(key) &&
              Array.isArray(raw?.deviceCheckStreams) && raw.deviceCheckStreams.length <= 4;
          }).length;
          v788t16jDevicePendingCount = Math.max(0, deviceCheckItems.length -
            v788t16jDevicePassedCount - v788t16jDeviceRejectedCount);
          console.log('[BU23MP PREFLIGHT SUMMARY]', 'passed=' + v788t16jDevicePassedCount,
            'terminalRejected=' + v788t16jDeviceRejectedCount, 'pending=' + v788t16jDevicePendingCount);

          console.log(
            '[V788T16J LIVE PREFLIGHT]',
            'pending=' +
              deviceCheckItems.length,
            'rows=' +
              candidateRows.length,
            'passed=' +
              v788t16jDevicePassedCount,
            'rejected=' +
              v788t16jDeviceRejectedCount
          );

        } catch (probeError) {
          // Strict pre-display contract:
          // if this device cannot prove an uncertain channel,
          // that channel never reaches the guide.
          v788t16jDeviceRejectedCount = 0;
          v788t16jDevicePendingCount = deviceCheckItems.length;

          console.warn(
            '[V788T16J LIVE PREFLIGHT] failed closed',
            'pending=' +
              deviceCheckItems.length,
            probeError
          );
        }
      }

      const inventoryItems = [
        ...backendPlayableItems,
        ...v788t16jDevicePassedItems,
      ];

      const enrichmentByIdentity =
        new Map<string, GuideChannel>();

      for (const channel of next) {
        const enrichmentId =
          String(
            channel.item.imdb_id ||
            channel.item.id ||
            ''
          ).trim();

        const enrichmentAddonId =
          String(
            channel.addonId ||
            ''
          ).trim();

        if (
          !enrichmentId ||
          !enrichmentAddonId
        ) {
          continue;
        }

        const identity =
          `${enrichmentAddonId}:${enrichmentId}`;

        if (
          !enrichmentByIdentity.has(identity)
        ) {
          enrichmentByIdentity.set(
            identity,
            channel
          );
        }
      }

      const playableByIdentity = buildPlayableRows(inventoryItems, epgByIdentity, enrichmentByIdentity);

      // W121ZLIVE175A: only a *confirmed* synthetic NexoTV rate-limit
      // may recover that exact addon's recently successful inventory rows.
      // A normal completed catalog stays authoritative, including genuine
      // deletions, empty-stream removals and device probe rejections.
      const w175aNexoDegraded = inventoryPayload?.nexoRateLimited === true;
      let w175aRecovered = 0;
      if (w175aNexoDegraded && generation === loadGenerationRef.current &&
          !w121zlive122Signal.aborted) {
        try {
          const scope = w161bScope();
          if (scope) {
            let recoveryRows: GuideChannel[] = [];
            let recoverySource = '';
            for (const candidate of [
              {key: W175A_NEXO_GOOD_KEY, maxAge: W175A_NEXO_GOOD_AGE_MS},
              // Migration: use the older complete-snapshot cache only if
              // its original one-hour freshness and account scope still pass.
              {key: W161B_CACHE_KEY, maxAge: W161B_MAX_AGE_MS},
            ]) {
              const raw = await W121zEpg161bStorage.getItem(candidate.key);
              if (!raw || raw.length > W175A_NEXO_GOOD_MAX_BYTES) continue;
              const snapshot = JSON.parse(raw);
              const ageMs = Date.now() - Number(snapshot?.savedAt);
              if (snapshot?.schema !== 1 || snapshot?.scope !== scope ||
                  !Number.isFinite(ageMs) || ageMs < 0 || ageMs > candidate.maxAge ||
                  !Array.isArray(snapshot?.channels) ||
                  snapshot.channels.length > W161B_MAX_ROWS) continue;
              const rows = snapshot.channels.filter((row: any) =>
                String(row?.addonId || '').trim() === 'community.nexotv' &&
                !!String(row?.key || '').trim() &&
                !!String(row?.item?.id || '').trim() &&
                !!String(row?.name || '').trim() &&
                String(row?.item?.id || '').trim() !== 'ratelimit_error' &&
                Array.isArray(row?.programs));
              if (rows.length > 0 && w161bScope() === scope) {
                recoveryRows = rows;
                recoverySource = candidate.key;
                break;
              }
            }
            if (generation === loadGenerationRef.current && !w121zlive122Signal.aborted &&
                w161bScope() === scope) {
              for (const old of recoveryRows) {
                const id = String(old.item.id).trim();
                const identity = 'community.nexotv:' + id;
                if (playableByIdentity.has(identity)) continue;
                const liveEpg = epgByIdentity.get(identity);
                playableByIdentity.set(identity, {
                  ...old,
                  programs: Array.isArray(liveEpg?.programs) ? liveEpg.programs : [],
                });
                w175aRecovered += 1;
              }
            }
            console.warn('[W121ZLIVE175A NEXO RECOVERY]',
              'rateLimited=true', 'source=' + recoverySource,
              'recovered=' + w175aRecovered,
              'scopeMatched=true');
          }
        } catch (error) {
          console.warn('[W121ZLIVE175A NEXO RECOVERY] skipped', String(error));
        }
      }

      const completedChannels =
        Array.from(
          playableByIdentity.values()
        );

      // W121ZLIVE147D: log the precise owner identities of the reported
      // numbered dead channels; no additional channel is suppressed.
      const abcRows = completedChannels.filter((ch) =>
        /^abc news live(?:\b|$)/i.test(v789gNormalize(ch.name))
      );
      console.log('[W121ZLIVE147D ABC INVENTORY]',
        'candidates=' + abcRows.length,
        'blocked=' + abcRows.filter(w121z147dConfirmedDead).length);
      for (const ch of abcRows.slice(0, 35)) {
        console.log('[W121ZLIVE147D ABC ROW]',
          'name=' + ch.name,
          'addon=' + String(ch.addonId || ''),
          'id=' + String(ch.item.id || ''),
          'blocked=' + w121z147dConfirmedDead(ch));
      }

      completedChannels.sort(
        (a, b) =>
          String(a.name || '').localeCompare(
            String(b.name || ''),
            undefined,
            {
              sensitivity: 'base',
              numeric: true,
            }
          )
      );

      // W121ZLIVE147B: collect cross-addon duplicate candidates WITHOUT
      // removing stations or changing their playback/favorite identities.
      // Names alone are NOT proof: local/East/West/HD feeds must stay separate.
      const shadowGroups = new Map<string, GuideChannel[]>();
      for (const entry of completedChannels) {
        const nameKey = v789gNormalize(entry.name)
          .replace(/[^a-z0-9]+/g, ' ').trim();
        if (!nameKey || nameKey.length < 4) continue;
        const members = shadowGroups.get(nameKey) || [];
        members.push(entry);
        shadowGroups.set(nameKey, members);
      }
      let duplicateCandidateGroups = 0;
      let candidateRowsLogged = 0;
      for (const [nameKey, members] of shadowGroups) {
        if (new Set(members.map((member) => member.addonId)).size < 2) {
          continue;
        }
        duplicateCandidateGroups += 1;
        if (candidateRowsLogged >= 100) continue;
        for (const member of members.slice(0, 5)) {
          const meta: any = member.item as any;
          const tvgId = String(
            meta?.tvgId || meta?.tvg_id ||
            meta?.behaviorHints?.tvgId || meta?.epgId || ''
          ).trim();
          console.log(
            '[W121ZLIVE147B DUPLICATE CANDIDATE]',
            `name=${nameKey}`,
            `addon=${String(member.addonId || '')}`,
            `id=${String(member.item.id || '')}`,
            `tvgId=${tvgId}`,
            `programs=${member.programs.length}`
          );
          candidateRowsLogged += 1;
        }
      }
      const withPrograms = completedChannels.filter(
        (member) => member.programs.length > 0
      ).length;
      const withLogo = completedChannels.filter(
        (member) => !!String(member.logo || '').trim()
      ).length;
      console.log(
        '[W121ZLIVE147B GUIDE SNAPSHOT]',
        `channels=${completedChannels.length}`,
        `epgEntries=${epgByIdentity.size}`,
        `withPrograms=${withPrograms}`,
        `withLogo=${withLogo}`,
        `crossAddonNameGroups=${duplicateCandidateGroups}`,
        'merged=0',
        'playbackUnchanged=true'
      );

      // W121ZLIVE147C: runtime evidence for conservative, EPG-backed
      // duplicate cleanup (final count can be lower when Favorites are saved).
      const scheduledShadowNames = new Set<string>();
      for (const group of shadowGroups.values()) {
        const addOns = new Set(group.map((entry) => entry.addonId));
        if (addOns.size < 2 || !addOns.has('com.stremtv.us')) continue;
        if (!group.some((entry) => entry.programs.length > 0)) continue;
        if (group.some((entry) => entry.programs.length === 0)) {
          scheduledShadowNames.add(v789gNormalize(group[0].name));
        }
      }
      console.log(
        '[W121ZLIVE147C SAFE DEDUPE]',
        `inventoryRows=${completedChannels.length}`,
        `epgBackedCandidateGroups=${scheduledShadowNames.size}`,
        'favoritesPreserved=true',
        'differentScheduledFeedsPreserved=true',
        'sourceInventoryUnchanged=true'
      );

      v788t10gRefreshResultRef.current =
        completedChannels;

      setChannels(
        completedChannels
      );
      // BU23JB: O(n) over the ALREADY-COMPLETED guide, no extra inventory requests.
      // Backend-playable/native-passed rows are positive stream URL evidence.
      // A Nexo rate-limit cannot renew positive evidence for recovered cached rows.
      if (generation === loadGenerationRef.current && !w121zlive122Signal.aborted) {
        void publishBU23JBGuideCounts(completedChannels,
          [...backendPlayableItems, ...v788t16jDevicePassedItems],
          w175aNexoDegraded).catch((error: unknown) =>
            console.warn('[BU23JB] guide count publish skipped', error));
      }

      console.log(
        '[V788T12K LIVE INVENTORY] stable guide commit',
        'channels=' + completedChannels.length,
        'pages=' + String(inventoryPayload?.pageCount || 0),
        'scanned=' + String(inventoryPayload?.scannedTotal || 0),
        'playable=' + String(inventoryPayload?.playableTotal || 0),
        'deviceCheck=' + String(inventoryPayload?.deviceCheckTotal || 0),
        'devicePassed=' + String(v788t16jDevicePassedCount),
        'deviceRejected=' + String(v788t16jDeviceRejectedCount),
        'empty=' + String(inventoryPayload?.emptyTotal || 0),
        'unknown=' + String(inventoryPayload?.unknownTotal || 0)
      );

      guideLoadedRef.current = true;
      lastGuideLoadAtRef.current = Date.now();

      // W121ZLIVE175A: only a healthy complete NexoTV inventory can replace
      // the durable recovery copy. Partial/rate-limited responses never renew it.
      if (!w175aNexoDegraded && v788t16jDevicePendingCount === 0 && generation === loadGenerationRef.current &&
          !w121zlive122Signal.aborted) {
        try {
          const scope = w161bScope();
          const nexotvRows = completedChannels.filter((row) =>
            String(row.addonId || '').trim() === 'community.nexotv' &&
            String(row.item?.id || '').trim().toLowerCase() !== 'ratelimit_error');
          if (scope && nexotvRows.length > 0 && nexotvRows.length <= W161B_MAX_ROWS) {
            const rows = nexotvRows.map((row) => ({
              key: row.key, item: row.item, name: row.name,
              logo: row.logo, sourceName: row.sourceName,
              addonId: row.addonId, programs: [] as GuideProgram[],
            }));
            const record = JSON.stringify({schema: 1, scope, savedAt: Date.now(), channels: rows});
            if (record.length <= W175A_NEXO_GOOD_MAX_BYTES && w161bScope() === scope) {
              void W121zEpg161bStorage.setItem(W175A_NEXO_GOOD_KEY, record)
                .then(() => console.log('[W121ZLIVE175A NEXO GOOD] saved=' + rows.length))
                .catch((error: unknown) => console.warn('[W121ZLIVE175A NEXO GOOD] write skipped', error));
            }
          }
        } catch (error) {
          console.warn('[W121ZLIVE175A NEXO GOOD] skipped', String(error));
        }
      }
      if (w175aNexoDegraded) {
        console.warn('[W121ZLIVE175A NEXO DEGRADED]',
          'recovered=' + w175aRecovered,
          'cacheOverwritePrevented=true',
          'channels=' + completedChannels.length);
      }

      // W121ZEPG161B: save only a complete authoritative inventory and
      // only when account/addon identity is known. Cache failure is nonfatal.
      if (!w175aNexoDegraded && v788t16jDevicePendingCount === 0 && completedChannels.length > 0 &&
          completedChannels.length <= W161B_MAX_ROWS &&
          generation === loadGenerationRef.current &&
          !w121zlive122Signal.aborted) {
        const scope = w161bScope();
        if (scope) {
          // Compact presentation snapshot: retain channel identity/playback item,
          // but NEVER persist the full 8-hour guide schedule per station.
          const compactChannels = completedChannels.map((channel) => ({
            key: channel.key,
            item: channel.item,
            name: channel.name,
            logo: channel.logo,
            sourceName: channel.sourceName,
            addonId: channel.addonId,
            programs: [] as GuideProgram[],
          }));
          const record = JSON.stringify({
            schema: 1, compact: true, scope, savedAt: Date.now(), channels: compactChannels,
          });
          if (record.length <= W161D_MAX_CACHE_BYTES) {
            void W121zEpg161bStorage.setItem(W161B_CACHE_KEY, record)
              .then(() => console.log('[W121ZEPG161G CACHE] SAVE rows=' + compactChannels.length +
                ' bytes=' + record.length))
              .catch((cacheError: unknown) =>
                console.warn('[W121ZEPG161D CACHE] save failed', cacheError));
          } else {
            console.warn('[W121ZEPG161D CACHE] snapshot over size limit; skipped');
          }
        }
      }

      // W121ZEPG161AM: store only a small near-term schedule index.
      // Non-blocking, scope-matched; failed writes cannot affect guide display.
      if (!w175aNexoDegraded && completedChannels.length > 0 &&
          completedChannels.length <= W161B_MAX_ROWS &&
          generation === loadGenerationRef.current &&
          !w121zlive122Signal.aborted) {
        const w161amScope = w161bScope();
        if (w161amScope) {
          const w161amNow = Date.now();
          const w161amHorizon = w161amNow + 3 * 60 * 60 * 1000;
          const w161amEntries = completedChannels.map((channel) => ({
            key: channel.key,
            programs: (Array.isArray(channel.programs) ? channel.programs : [])
              .filter((p) => {
                const start = Date.parse(p.startTime);
                const end = Date.parse(p.endTime);
                return Number.isFinite(start) && Number.isFinite(end) &&
                  end > w161amNow && start < w161amHorizon;
              })
              .slice(0, 5)
              .map((p) => ({
                title: String(p.title || '').slice(0, 240),
                startTime: p.startTime, endTime: p.endTime,
              })),
          })).filter((entry) => entry.programs.length > 0);
          const w161amRecord = JSON.stringify({
            schema: 1, scope: w161amScope, savedAt: w161amNow,
            entries: w161amEntries,
          });
          if (w161amRecord.length <= W161AM_PROGRAM_MAX_BYTES) {
            void W121zEpg161bStorage.setItem(W161AM_PROGRAM_KEY, w161amRecord)
              .then(() => console.log('[W121ZEPG161AM EPG] saved near-term schedules',
                'channels=' + w161amEntries.length, 'bytes=' + w161amRecord.length))
              .catch((e: unknown) => console.warn('[W121ZEPG161AM EPG] save skipped', e));
          } else {
            console.warn('[W121ZEPG161AM EPG] schedules exceeded size cap');
          }
        }
      }

      console.log(
        '[V785A LIVE GUIDE] snapshot committed channels=' + completedChannels.length
      );
    } catch (error) {
      console.warn('[V784J_LIVE_TV] guide load failed', error);
      // Never destroy an already-painted guide because a later refresh failed.
      if (
        generation === loadGenerationRef.current &&
        !guideLoadedRef.current
      ) {
        setChannels([]);
      }
    } finally {
      if (
        w121zlive122GuideAbortRef.current ===
        w121zlive122Controller
      ) {
        w121zlive122GuideAbortRef.current = null;
      }

      if (generation === loadGenerationRef.current) {
        guideLoadInFlightRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  // W121ZOD110N_LIVE_TV_FOCUS_OWNED_LOAD
  //
  // Live TV is eagerly mounted by the tab navigator, but expensive
  // inventory / device preflight work must not start merely because
  // this tab exists in the mounted tree.
  //
  // The useFocusEffect below is the sole owner of initial guide load.
  // It already cold-loads when Live TV actually receives focus and
  // preserves the completed guide while /player sits above it.
  //
  // This prevents background Live-TV probes from competing with
  // on-demand Details / Premiumize startup on constrained TV devices.

  // V788T8V_RETURN_FOCUS_HANDSHAKE
  //
  // W121ZSY26B_ATOMIC_FOCUS_RESTORE_REQUEST
  // Keep explicit restore target independent from
  // preferredFocusIndex.
  const [
    v788t8vFocusRestoreRequest,
    setV788t8vFocusRestoreRequest,
  ] = useState<{
    index: number;
    serial: number;
  }>({
    index: 0,
    serial: 0,
  });

  useFocusEffect(
    useCallback(() => {
      // W121ZLIVE123_SCREEN_FOCUS_OWNER
      w121zlive123ScreenFocusedRef.current = true;
      const bu23okReturningFromPlayer = bu23okPlaybackReturnRef.current;
      bu23okPlaybackReturnRef.current = false;
      if (!bu23okReturningFromPlayer) {
        // Fresh tab entry: select Favorites synchronously, before any fetch.
        setV789gCategory('favorites');
        setPreferredChannelIndex(-1);
        setV788t8vFocusRestoreRequest({ index: -1, serial: 0 });
        v789mCategoryExitPendingRef.current = false;
        v789hCategoryFocusedIndexRef.current = -1;
        v789hCategoryModeRef.current = true;
        setV789hCategoryMode(true);
        setV789nNativeCategoryPreferredIndex(0);
        setV789nNativeCategoryFocusSerial(value => value + 1);
        console.log('[BU23OK FAVORITES ENTRY] fresh=true category=favorites');
      } else {
        console.log('[BU23OK FAVORITES ENTRY] playbackReturn=true preserveCategory=true');
      }
      // On genuine return from /player, allow the next single selection.
      w121z148fLaunchRef.current = null;
      w121z148hRouteActiveRef.current = false;
      DeviceEventEmitter.emit('W121ZLIVE148I_COVER_CLEAR', { reason: 'guide-focus' });
      setW121z148fOpening('');
      setW121z148gOpeningLogo('');

      console.log(
        '[W121ZLIVE123 LIVE INPUT OWNER]',
        'active=true'
      );

      // V785L6B_LIVE_GUIDE_FOCUS_RETURN
      if (bu23okReturningFromPlayer) try {
        const {
          getLiveTvCurrent,
        } = require('../../src/liveTvNav');

        const current = getLiveTvCurrent();

        const restoreId = String(
          current?.entry?.id || ''
        ).trim();

        const restoreAddonId = String(
          current?.entry?.addonId || ''
        ).trim();

        const visibleChannels =
          v789gVisibleChannelsRef.current;

        const restoreIndex =
          restoreId && restoreAddonId
            ? visibleChannels.findIndex(
                (channel) => {
                  const id = String(
                    channel.item.imdb_id ||
                    channel.item.id ||
                    ''
                  ).trim();

                  const addonId = String(
                    channel.addonId || ''
                  ).trim();

                  return (
                    id === restoreId &&
                    addonId === restoreAddonId
                  );
                }
              )
            : -1;

        if (restoreIndex >= 0) {
          v788qPreferredFocusArmedRef.current =
            true;

          // W121ZSY26B_SINGLE_OWNER_PLAYBACK_RETURN
          //
          // Playback identity has already been resolved here.
          // Do not also mutate preferredChannelIndex because that
          // independently enters native setPreferredFocusIndex().
          // Playback return uses only the explicit restore request.
          setV788t8vFocusRestoreRequest(
            (request) => ({
              index: restoreIndex,
              serial: request.serial + 1,
            })
          );

          console.log(
            '[W121ZSY3 LIVE RETURN] identity restore',
            'index=' + restoreIndex,
            'id=' + restoreId,
            'addon=' + restoreAddonId,
            'visible=' + visibleChannels.length
          );
        } else if (current) {
          console.warn(
            '[W121ZSY3 LIVE RETURN] identity not visible',
            'id=' + restoreId,
            'addon=' + restoreAddonId,
            'storedIndex=' +
              String(current?.index ?? -1),
            'visible=' + visibleChannels.length
          );
        }
      } catch (error) {
        console.warn(
          '[V785L6B LIVE GUIDE] focus restore lookup failed',
          error
        );
      }

      let v788t10gSourcesDirty = false;

      try {
        const {
          consumeLiveTvSourcesDirty,
        } = require('../../src/liveTvNav');

        v788t10gSourcesDirty =
          consumeLiveTvSourcesDirty();
      } catch (error) {
        console.warn(
          '[V788T10G2 LIVE GUIDE] dirty-state lookup failed',
          error
        );
      }
      const ageMs =
        lastGuideLoadAtRef.current > 0
          ? Date.now() - lastGuideLoadAtRef.current
          : Number.POSITIVE_INFINITY;

      if (
        v788t10gSourcesDirty &&
        guideLoadedRef.current
      ) {
        let restoreId = '';
        let restoreAddonId = '';
        let fallbackIndex = 0;

        try {
          const {
            getLiveTvCurrent,
          } = require('../../src/liveTvNav');

          const current =
            getLiveTvCurrent();

          restoreId = String(
            current?.entry?.id || ''
          ).trim();

          restoreAddonId = String(
            current?.entry?.addonId || ''
          ).trim();

          const visibleBeforeRefresh =
            v789gVisibleChannelsRef.current;

          const visibleCurrentIndex =
            restoreId && restoreAddonId
              ? visibleBeforeRefresh.findIndex(
                  (channel) => {
                    const id = String(
                      channel.item.imdb_id ||
                      channel.item.id ||
                      ''
                    ).trim();

                    const addonId = String(
                      channel.addonId || ''
                    ).trim();

                    return (
                      id === restoreId &&
                      addonId === restoreAddonId
                    );
                  }
                )
              : -1;

          if (visibleCurrentIndex >= 0) {
            fallbackIndex =
              visibleCurrentIndex;
          }
        } catch (error) {
          console.warn(
            '[V788T10G2 LIVE GUIDE] pre-refresh focus capture failed',
            error
          );
        }

        console.log(
          '[V788T10G2 LIVE GUIDE] addon sources dirty - refresh on focus',
          'id=' + restoreId,
          'addon=' + restoreAddonId,
          'fallbackIndex=' + fallbackIndex
        );

        v788t10gRefreshResultRef.current = null;

        void (async () => {
          await Promise.all([
            loadGuide(true),
            fetchLibrary(true),
          ]);

          const refreshed =
            v788t10gRefreshResultRef.current;

          if (!Array.isArray(refreshed)) {
            try {
              const {
                markLiveTvSourcesDirty,
              } = require('../../src/liveTvNav');

              markLiveTvSourcesDirty();
            } catch (_) {}

            console.warn(
              '[V788T10G2 LIVE GUIDE] refresh did not commit - dirty flag restored'
            );

            return;
          }

          // Fresh tab entry owns category focus; do not restore a stale playback row.
          if (!bu23okReturningFromPlayer || !w121zlive123ScreenFocusedRef.current) return;

          const refreshedVisible =
            v789gFilterChannels(
              refreshed,
              v789gCategoryRef.current,
              v788t8xIsFavoriteRef.current
            );

          let restoreIndex = -1;

          if (
            restoreId &&
            restoreAddonId
          ) {
            restoreIndex =
              refreshedVisible.findIndex(
                (channel) => {
                  const id = String(
                    channel.item.imdb_id ||
                    channel.item.id ||
                    ''
                  ).trim();

                  const addonId = String(
                    channel.addonId || ''
                  ).trim();

                  return (
                    id === restoreId &&
                    addonId === restoreAddonId
                  );
                }
              );
          }

          if (
            restoreIndex < 0 &&
            refreshedVisible.length > 0
          ) {
            restoreIndex =
              Math.min(
                Math.max(
                  fallbackIndex,
                  0
                ),
                refreshedVisible.length - 1
              );
          }

          if (restoreIndex < 0) {
            console.log(
              '[V788T10G2 LIVE GUIDE] refreshed guide empty - no focus target'
            );
            return;
          }

          requestAnimationFrame(() => {
            v788qPreferredFocusArmedRef.current =
              true;

            setPreferredChannelIndex(
              restoreIndex
            );

            setV788t8vFocusRestoreRequest(
              (request) => ({
                index: restoreIndex,
                serial: request.serial + 1,
              })
            );

            console.log(
              '[V788T10G2 LIVE GUIDE] post-refresh focus restore',
              'index=' + restoreIndex,
              'visibleChannels=' +
                refreshedVisible.length
            );
          });
        })();
      } else if (!guideLoadedRef.current) {
        console.log('[V785A LIVE GUIDE] cold load');

        void Promise.all([
          loadGuide(false),
          fetchLibrary(true),
        ]);
      } else if (ageMs >= 5 * 60 * 1000) {
        // Refresh stale EPG data without replacing the screen with a loader.
        console.log(
          '[V785A LIVE GUIDE] stale snapshot - silent refresh ageMs=' +
            ageMs
        );

        void Promise.all([
          loadGuide(true),
          fetchLibrary(true),
        ]);
      } else {
        console.log(
          '[V785A LIVE GUIDE] focus return - preserve snapshot ageMs=' +
            ageMs
        );
      }

      // W121ZLIVE122_LIVE_FOCUS_OWNED_CANCEL
      //
      // Preserve the already-painted guide across /player and tab
      // navigation, but release ownership of unfinished background
      // EPG/inventory work immediately when Live loses focus.
      return () => {
        // W121ZLIVE123_SCREEN_FOCUS_OWNER
        //
        // Release remote ownership BEFORE any asynchronous cancellation
        // cleanup. Also unregister the station long-press getter so an OD
        // hold cannot call back into the hidden Live station.
        bu23okPlaybackReturnRef.current = w121z148hRouteActiveRef.current;
        w121zlive123ScreenFocusedRef.current = false;

        v788pClearStationLongPress();

        v788t8cFocusAreaRef.current = 'none';
        v788t8cFocusedRowRef.current = null;
        v788t8cFirstLeftRef.current = 0;
        v788t8cRawLeftRef.current = 0;

        console.log(
          '[W121ZLIVE123 LIVE INPUT OWNER]',
          'active=false',
          'longPressCleared=true'
        );

        const w121zlive122Controller =
          w121zlive122GuideAbortRef.current;

        const w121zlive122CancelledGeneration =
          loadGenerationRef.current;

        loadGenerationRef.current += 1;

        guideLoadInFlightRef.current = false;

        if (
          w121zlive122Controller &&
          !w121zlive122Controller.signal?.aborted
        ) {
          w121zlive122Controller.abort();
        }

        if (
          w121zlive122GuideAbortRef.current ===
          w121zlive122Controller
        ) {
          w121zlive122GuideAbortRef.current = null;
        }

        console.log(
          '[W121ZLIVE122 LIVE BLUR CANCEL]',
          'generation=' +
            w121zlive122CancelledGeneration,
          'aborted=' +
            String(
              Boolean(w121zlive122Controller)
            ),
          'guidePreserved=' +
            String(guideLoadedRef.current)
        );
      };
    }, [
      loadGuide,
      fetchLibrary,
      v788pClearStationLongPress,
    ])
  );

  const openChannel = useCallback(async (channel: GuideChannel) => {
    const id = String(
      channel.item.imdb_id ||
      channel.item.id ||
      ''
    ).trim();

    if (!id) return;

    const addonId = String(channel.addonId || '').trim();

    if (!addonId) {
      console.warn('[V784N LIVE TV] missing owning addon', id);
      return;
    }

    // W121ZLIVE148F: atomically freeze the first native Select identity.
    // Do not allow another native press to race a pending getStreams request.
    if (w121z148fLaunchRef.current) {
      console.log('[W121ZLIVE148F DUPLICATE SELECT IGNORED]',
        'pending=' + w121z148fLaunchRef.current,
        'requested=' + addonId + ':' + id);
      return;
    }
    w121z148fLaunchRef.current = addonId + ':' + id;
    w121z148hRouteActiveRef.current = false;
    const w121z148hAttempt = ++w121z148hAttemptSeqRef.current;
    setW121z148fOpening(String(channel.name || id));
    setW121z148gOpeningLogo(w172dLogoFor(channel));
    DeviceEventEmitter.emit('W121ZLIVE148I_COVER_BEGIN', {
      addonId, contentId: id,
      title: String(channel.name || id), logo: w172dLogoFor(channel),
    });
    console.log('[W121ZLIVE148I ROOT COVER BEGIN]', 'channel=' + addonId + ':' + id);
    console.log('[W121ZLIVE148G FULLSCREEN LOADING]', 'addon=' + addonId, 'id=' + id);
    let w121z148fNavigated = false;
    console.log('[W121ZLIVE148F SELECT LOCKED]',
      'addon=' + addonId, 'id=' + id);

    // W121ZLIVE147D owner identity for a user-confirmed silent channel.
    // Diagnostic only: stream selection and native player remain unchanged.
    console.log('[W121ZLIVE147D CHANNEL LAUNCH]',
      'name=' + String(channel.name || ''),
      'addon=' + addonId,
      'id=' + id);

    try {
      // V784N_DIRECT_OWNER_PLAYBACK
      // Resolve ONLY through the addon that supplied this channel.
      const result = await api.addons.getStreams(
        addonId,
        'tv',
        id
      );
      // A Back action while the full-screen load is pending invalidates
      // that request. A stale result can never open a player afterward.
      if (w121z148hAttempt !== w121z148hAttemptSeqRef.current) {
        console.log('[W121ZLIVE148H CANCELED RESOLVE]', id);
        return;
      }
      const streams = Array.isArray(result?.streams)
        ? result.streams
        : [];

      const directStreams = streams
        .map((stream: any) => {
          const streamUrl = String(
            stream?.url ||
            stream?.directUrl ||
            stream?.proxyUrl ||
            ''
          ).trim();

          return {
            ...stream,
            _liveUrl: streamUrl,
          };
        })
        .filter((stream: any) => {
          return (
            /^https?:\/\//i.test(stream._liveUrl) ||
            stream._liveUrl.startsWith('/api/')
          );
        });

      const primary =
        directStreams.find((stream: any) =>
          /\.m3u8(?:[?#]|$)/i.test(stream._liveUrl)
        ) ||
        directStreams[0];

      if (!primary) {
        console.warn(
          '[V784M LIVE TV] no direct stream for',
          id
        );
        return;
      }

      const fallbacks = directStreams
        .filter((stream: any) => stream !== primary)
        .slice(0, 12)
        .map((stream: any) => ({
          url: stream._liveUrl,
          name: stream.name || '',
          title: stream.title || '',
          addon: stream.addon || '',
        }));

      // V785L5_LIVE_CHANNEL_NAV
      try {
        const {
          setLiveTvNavSnapshot,
        } = require('../../src/liveTvNav');

        setLiveTvNavSnapshot(
          v789gVisibleChannels.map((entry) => ({
            id: String(
              entry.item.imdb_id ||
              entry.item.id ||
              ''
            ).trim(),
            addonId: String(
              entry.addonId || ''
            ).trim(),
            name: String(entry.name || ''),
            logo: w172dLogoFor(entry),
            sourceName: String(entry.sourceName || ''),
            // W121ZLIVE152B: The guide already owns these EPG entries.
            // Retain the same reference in LiveTvNav instead of rebuilding
            // thousands of program objects each time a station is opened.
            // No station identity, guide data, or program time is dropped.
            programs: Array.isArray(entry.programs)
              ? entry.programs
              : [],
          })),
          id,
          addonId
        );

        console.log(
          '[W121ZSY3 LIVE SURF] visible snapshot',
          'channels=' +
            v789gVisibleChannels.length,
          'id=' + id,
          'addon=' + addonId
        );
      } catch (error) {
        console.warn(
          '[V785L5 LIVE SURF] snapshot failed',
          error
        );
      }

      w121z148hRouteActiveRef.current = true;
      router.push({
        pathname: '/player',
        params: {
          directUrl: primary._liveUrl,
          title: channel.name,
          isLive: 'true',
          liveGuideLaunch: '148F',
          liveSingleCover: '148H',
          contentType: 'tv',
          contentId: id,
          addonId: addonId,
          logo: w172dLogoFor(channel),
          poster: '',
          backdrop: '',
          fallbackStreams: JSON.stringify(fallbacks),
        },
      } as any);
      w121z148fNavigated = true;
      // Absolute safety exit for an unresponsive player/status callback.
      // Normal source playback uses the explicit PLAYER_COVER_END event.
      setTimeout(() => {
        if (w121z148hAttemptSeqRef.current === w121z148hAttempt &&
            w121z148hRouteActiveRef.current) {
          console.warn('[W121ZLIVE148H LOADER SAFETY EXIT]');
          setW121z148fOpening('');
          setW121z148gOpeningLogo('');
        }
      }, 45000);

    } catch (error) {
      console.warn(
        '[V784M LIVE TV] stream resolve failed',
        id,
        error
      );
    } finally {
      // On errors/no streams, permit another click. After navigation leave
      // it locked until Live TV regains focus (prevent stacked /player routes).
      if (!w121z148fNavigated && w121z148hAttempt === w121z148hAttemptSeqRef.current) {
        w121z148fLaunchRef.current = null;
        DeviceEventEmitter.emit('W121ZLIVE148I_COVER_CLEAR', {
          addonId, contentId: id, reason: 'resolve-failed-or-no-stream',
        });
        setW121z148fOpening('');
        setW121z148gOpeningLogo('');
      }
    }
  }, [router, v789gVisibleChannels]);

  // V788T8Z_PERSISTED_BOOKMARK_ACK
  // W121ZPLAY10Y24Q_PERSISTED_CHANNEL_ID_ALIASES
  const v788t8zLibraryHasChannel = useCallback(
    (id: string) => {
      const currentLibrary: any =
        useContentStore.getState().library;

      const libraryChannels: any[] =
        ([] as any[]).concat(
          currentLibrary?.channels || [],
          currentLibrary?.tv || []
        );

      return libraryChannels.some(
        (item: any) =>
          [
            item?.content_id,
            item?.imdb_id,
            item?.id,
          ].some(
            (raw) =>
              String(raw || '').trim() === id
          )
      );
    },
    []
  );

  const toggleFavorite = useCallback(
    async (channel: GuideChannel) => {
      const id = String(
        channel.item.imdb_id ||
        channel.item.id ||
        ''
      ).trim();

      if (!id) return;

      const wasFavorite =
        v788t8xIsFavorite(id);

      const nextFavorite =
        !wasFavorite;

      // Immediate visual response.
      setV788t8xFavoriteOverrides(
        (previous) => ({
          ...previous,
          [id]: nextFavorite,
        })
      );

      // W121ZPLAY10Y23A_DIRECT_GUIDE_FAVORITE_PUSH
      // Feed the favorite-only delta directly to the currently mounted
      // native guide before persistence begins. The native guide's
      // existing favorite-only fast path owns the direct badge repaint.
      const v788y23CurrentGuideItems =
        v788y23GuideItemsRef.current;

      if (v788y23CurrentGuideItems.length > 0) {
        const v788y23NextGuideItems =
          v788y23CurrentGuideItems.map(
            (item: any) =>
              item.key === channel.key
                ? {
                    ...item,
                    favorite: nextFavorite,
                  }
                : item
          );

        v788y23GuideItemsRef.current =
          v788y23NextGuideItems;

        try {
          v788y23GuideRef.current?.setNativeProps({
            items: v788y23NextGuideItems,
          });

          console.log(
            '[W121ZPLAY10Y23A DIRECT GUIDE FAVORITE]',
            channel.key,
            nextFavorite
          );
        } catch (error) {
          console.warn(
            '[W121ZPLAY10Y23A DIRECT GUIDE FAVORITE FAILED]',
            error
          );
        }
      }

      console.log(
        '[V788T8Z BOOKMARK] optimistic',
        id,
        nextFavorite
      );

      try {
        if (wasFavorite) {
          await removeFromLibrary(
            'tv',
            id
          );
        } else {
          await addToLibrary({
            ...channel.item,
            id,
            type: 'tv',
            poster:
              channel.item.poster ||
              channel.logo ||
              '',
          });
        }

        // W121ZPLAY10Y24L_SINGLE_LIBRARY_SYNC
        // addToLibrary/removeFromLibrary already await fetchLibrary()
        // in V176J_STORE_FINALLY. Do not issue a second GET here.
        // Verify the authoritative store state they just refreshed.
        const persistedFavorite =
          v788t8zLibraryHasChannel(id);

        console.log(
          '[V788T8Z BOOKMARK] persisted-check',
          id,
          'wanted=' + nextFavorite,
          'actual=' + persistedFavorite
        );

        if (persistedFavorite !== nextFavorite) {
          throw new Error(
            'library did not confirm bookmark state'
          );
        }

        // V788T8ZA_STICKY_CONFIRMED_BOOKMARK
        // The server has confirmed the requested state.
        // Keep the same value pinned for this Live TV mount.
        setV788t8xFavoriteOverrides(
          (previous) =>
            previous[id] === nextFavorite
              ? previous
              : {
                  ...previous,
                  [id]: nextFavorite,
                }
        );

        console.log(
          '[V788T8ZA BOOKMARK] confirmed-sticky',
          id,
          nextFavorite
        );
      } catch (error) {
        // The authoritative library did not confirm
        // the requested state. Put the visual back.
        setV788t8xFavoriteOverrides(
          (previous) => ({
            ...previous,
            [id]: wasFavorite,
          })
        );

        console.warn(
          '[V788T8Z BOOKMARK] persistence not confirmed',
          id,
          error
        );
      }
    },
    [
      v788t8xIsFavorite,
      v788t8zLibraryHasChannel,
      addToLibrary,
      removeFromLibrary,
    ]
  );

 // V788P5D_POSTER_STYLE_CHANNEL_BOOKMARK
 v788pToggleFavoriteRef.current =
   toggleFavorite;

 // V789H_CATEGORY_BUTTON_RENDERER
 const v789gRenderCategoryButton = (
   category: V789gCategoryDef,
   visualIndex: number
 ) => {
   const selected =
     v789gCategory ===
     category.key;

   const selfTag =
     v789hCategoryTags[
       visualIndex
     ] || undefined;

   const leftTag =
     visualIndex > 0
       ? (
           v789hCategoryTags[
             visualIndex - 1
           ] || selfTag
         )
       : selfTag;

   const rightTag =
     visualIndex <
     v789gVisibleCategoryDefsRef.current.length -
       1
       ? (
           v789hCategoryTags[
             visualIndex + 1
           ] || selfTag
         )
       : selfTag;

   return (
     <Pressable
       key={category.key}
       ref={(node: any) =>
         v789hRegisterCategoryRef(
           visualIndex,
           node
         )
       }
       accessibilityLabel={
         category.label
       }
       // V789N_CATEGORY_LAYOUT
       onLayout={(event: any) => {
         const layout =
           event?.nativeEvent?.layout;

         if (!layout) {
           return;
         }

         const x =
           Number(layout.x);

         const width =
           Number(layout.width);

         if (
           !Number.isFinite(x) ||
           !Number.isFinite(width) ||
           width <= 0
         ) {
           return;
         }

         v789nCategoryLayoutsRef
           .current[visualIndex] = {
             x,
             width,
           };
       }}       focusable={
         v789hCategoryMode
       }
       nextFocusLeft={
         leftTag
       }
       nextFocusRight={
         rightTag
       }
       nextFocusUp={
         selfTag
       }
       // V789M_EXPLICIT_CATEGORY_DOWN
       // Prevent Android spatial search from choosing
       // an arbitrary guide child. JS requests row 0.
       nextFocusDown={
         selfTag
       }       onFocus={() => {
         v789hCategoryModeRef
           .current = true;

         setV789hCategoryMode(
           true
         );

         v789hCategoryFocusedIndexRef
           .current =
           visualIndex;

         // V789K_R6_COMMIT_CATEGORY_HANDOFF
         // Android focus is confirmed here.
         // It is now safe to retire station-only state.
         v788pClearStationLongPress();
         v788t8cFocusAreaRef
           .current = 'none';

         v788t8cFocusedRowRef
           .current = null;

         v788t8cFirstLeftRef
           .current = 0;

         v788t8cRawLeftRef
           .current = 0;

         // V789N_CATEGORY_SCROLL_OWNER
         // Focus already moved to the exact adjacent pill.
         // Only scroll if its real bounds leave the viewport.
         v789nEnsureCategoryVisible(
           visualIndex,
           false
         );
         console.log(
           '[V789H CATEGORY FOCUS] ' +
             'index=' +
             visualIndex +
             ' key=' +
             category.key
         );
       }}
       // V789M_CATEGORY_BLUR_NO_AUTO_EXIT
       //
       // Horizontal category-to-category focus may take
       // longer than one frame on Fire TV. Blur itself is
       // NOT an exit condition anymore.
       onBlur={() => {
         if (
           v789hCategoryFocusedIndexRef
             .current ===
           visualIndex
         ) {
           v789hCategoryFocusedIndexRef
             .current = -1;
         }
       }}       onPress={() =>
         v789gSelectCategory(
           category.key
         )
       }
       style={({
         focused,
       }: any) => [
         styles.v789gCategoryButton,
         selected &&
           styles.v789gCategoryButtonSelected,
         focused &&
           styles.v789gCategoryButtonFocused,
       ]}
     >
       {category.key ===
         'favorites' && (
         <Ionicons
           name="star"
           size={17}
           color={
             selected
               ? '#0c0c0c'
               : '#B8A05C'
           }
         />
       )}

       <Text
         style={[
           styles.v789gCategoryText,
           selected &&
             styles.v789gCategoryTextSelected,
         ]}
       >
         {category.label}
       </Text>
     </Pressable>
   );
 };
 // V788T8L_NATIVE_STATION_ITEMS
  // V789N_NATIVE_CATEGORY_ITEMS
  const v789nNativeCategoryItems =
    useMemo(
      () =>
        v789gVisibleCategoryDefs.map(
          (category) => ({
            id: category.key,
            label: category.label,
            selected:
              category.key ===
              v789gCategory,
          })
        ),
      [
        v789gCategory,
        v789gVisibleCategoryDefs,
      ]
    );

  // V789N_NATIVE_CATEGORY_FOCUS
  const v789nHandleNativeCategoryFocus =
    useCallback(
      (event: any) => {
        const index =
          Number(
            event?.nativeEvent?.index
          );

        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >=
            v789gVisibleCategoryDefsRef.current.length
        ) {
          return;
        }

        const category =
          v789gVisibleCategoryDefsRef.current[index];

        // V789S6_IGNORE_STALE_CATEGORY_FOCUS_DURING_EXIT
        //
        // Runtime proof from V789S5 showed the guide taking row-0 focus,
        // followed by a delayed native category focus callback that turned
        // category mode back on. Ignore category callbacks once an exit is
        // pending or the guide has already retired category mode.
        if (
          v789mCategoryExitPendingRef.current ||
          !v789hCategoryModeRef.current
        ) {
          console.log(
            '[V789S6 STALE CATEGORY FOCUS IGNORED] ' +
              'index=' +
              index +
              ' key=' +
              category.key +
              ' pendingExit=' +
              String(
                v789mCategoryExitPendingRef.current
              ) +
              ' categoryMode=' +
              String(
                v789hCategoryModeRef.current
              )
          );

          return;
        }

        v789hCategoryModeRef.current =
          true;

        setV789hCategoryMode(
          true
        );

        v789hCategoryFocusedIndexRef
          .current =
          index;

        v789mCategoryExitPendingRef.current =
          false;

        // Do NOT feed preferredFocusIndex back on every
        // horizontal focus move. Native RecyclerView owns
        // LEFT/RIGHT from this point forward.
        v788pClearStationLongPress();

        v788t8cFocusAreaRef.current =
          'none';

        v788t8cFocusedRowRef.current =
          null;

        v788t8cFirstLeftRef.current =
          0;

        v788t8cRawLeftRef.current =
          0;

        console.log(
          '[V789N NATIVE CATEGORY FOCUS] ' +
            'index=' +
            index +
            ' key=' +
            category.key
        );
      },
      [
        v788pClearStationLongPress,
      ]
    );

  // V789N_NATIVE_CATEGORY_PRESS
  const v789nHandleNativeCategoryPress =
    useCallback(
      (event: any) => {
        const index =
          Number(
            event?.nativeEvent?.index
          );

        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >=
            v789gVisibleCategoryDefsRef.current.length
        ) {
          return;
        }

        const category =
          v789gVisibleCategoryDefsRef.current[index];

        console.log(
          '[V789N NATIVE CATEGORY PRESS] ' +
            'index=' +
            index +
            ' key=' +
            category.key
        );

        // If the selected-state data refresh momentarily
        // detaches the holder, fallback focus returns to
        // the item the user actually selected.
        setV789nNativeCategoryPreferredIndex(
          index
        );

        v789gSelectCategory(
          category.key
        );
      },
      [
        v789gSelectCategory,
      ]
    );

  const v789nHandleNativeCategoryBlur =
    useCallback(
      () => {
        // V789M owns the category -> guide exit commit.
        // A row blur by itself does not retire category mode.
        console.log(
          '[V789N NATIVE CATEGORY BLUR] ' +
            'pendingExit=' +
            String(
              v789mCategoryExitPendingRef
                .current
            )
        );
      },
      []
    );
 const v788t8lStationItems = useMemo(
   () =>
     v789gVisibleChannels.map((channel) => {
       const id = String(
         channel.item.imdb_id ||
         channel.item.id ||
         ''
       );

       return {
         key: channel.key,
         title: channel.name,
         logo: w172dLogoFor(channel) || null,
         favorite: v788t8xIsFavorite(id),
       };
     }),
   [v789gVisibleChannels, v788t8xIsFavorite]
 );

 // V788T4A_PROGRAM_GEOMETRY
 // Snap the horizontal guide to the focused program.
 // Queued animations can move content underneath native TV focus.
 // V788T8P_WHOLE_ROW_NATIVE_ITEMS
 const v788t8pGuideItems = useMemo(
   () =>
     v789gVisibleChannels.map((channel) => {
       const id = String(
         channel.item.imdb_id ||
         channel.item.id ||
         ''
       );

       return {
         key: channel.key,
         title: channel.name,
         logo: w172dLogoFor(channel) || null,
         favorite: v788t8xIsFavorite(id),
         programs: channel.programs
           .map((program, index) => ({
             id: String(
               program.id || index
             ),
             title: String(
               program.title || 'Programming'
             ),
             startMs:
               new Date(
                 program.startTime
               ).getTime(),
             endMs:
               new Date(
                 program.endTime
               ).getTime(),
           }))
           .filter((program) =>
             Number.isFinite(program.startMs) &&
             Number.isFinite(program.endMs) &&
             program.endMs > program.startMs
           ),
       };
     }),
   [v789gVisibleChannels, v788t8xIsFavorite]
 );

 // W121ZEPG161Z: timing-only instrumentation; NO behavior change.
 const w161zGuideReadyTimeRef = useRef<number>(0);
 useEffect(() => {
   if (!loading && channels.length > 0) {
     w161zGuideReadyTimeRef.current = Date.now();
     console.log('[W121ZEPG161Z GUIDE COMMIT] channels=' + channels.length +
       ' visible=' + v789gVisibleChannels.length +
       ' nativeItems=' + v788t8pGuideItems.length);
   }
 }, [loading, channels, v788t8pGuideItems, v789gVisibleChannels]);
 // W121ZPLAY10Y24X_STABLE_DIRECT_GUIDE_CACHE
 // Y24L intentionally keeps v788t8pGuideItems stable across favorite
 // state changes. Only reseed the mutable direct-guide cache when the
 // structural/native guide-items memo itself actually changes.
 useEffect(() => {
   v788y23GuideItemsRef.current =
     v788t8pGuideItems;
 }, [v788t8pGuideItems]);
 const focusProgram = useCallback((left: number) => {
    const nextX =
      Math.max(0, left - 40);

    timelineRef.current?.scrollTo({
      x: nextX,
      animated: false,
    });

    timelineHeaderRef.current?.scrollTo({
      x: nextX,
      animated: false,
    });
  }, []);

  // V788T7B_DETERMINISTIC_STATION_VERTICAL_FOCUS
  // The channel column must not use Android spatial search.
  // Native Up/Down is wired to the exact adjacent channel row.
  const v788t7WireStationFocus = useCallback(() => {
    const entries =
      Array.from(
        v788t7StationFocusMapRef.current.values()
      );

    const byRow =
      new Map<number, any>();

    for (const entry of entries) {
      byRow.set(
        entry.rowIndex,
        entry
      );
    }

    for (const entry of entries) {
      const up =
        byRow.get(
          entry.rowIndex - 1
        );

      const down =
        byRow.get(
          entry.rowIndex + 1
        );

      const selfTag =
        entry.tag || undefined;

      try {
        entry.ref?.setNativeProps({
          nextFocusUp:
            up?.tag || selfTag,

          nextFocusDown:
            down?.tag || selfTag,

          // V788T8C3_STATION_LEFT_TRAP
          nextFocusLeft:
            selfTag,
        });
      } catch (_) {}
    }
  }, []);

  const v788t7ScheduleStationFocusWire =
    useCallback(() => {
      if (
        v788t7StationFocusWireTimerRef.current !=
          null
      ) {
        clearTimeout(
          v788t7StationFocusWireTimerRef.current
        );
      }

      v788t7StationFocusWireTimerRef.current =
        setTimeout(() => {
          v788t7StationFocusWireTimerRef.current =
            null;

          v788t7WireStationFocus();
        }, 0);
    }, [v788t7WireStationFocus]);

  const v788t7RegisterStationFocus =
    useCallback(
      (
        key: string,
        rowIndex: number,
        node: any
      ) => {
        const registry =
          v788t7StationFocusMapRef.current;

        if (!node) {
          const priorPending =
            v788t7PendingStationUnregisterRef.current.get(
              key
            );

          if (priorPending != null) {
            clearTimeout(priorPending);
          }

          const pending =
            setTimeout(() => {
              v788t7PendingStationUnregisterRef.current.delete(
                key
              );

              const removed =
                registry.delete(key);

              if (removed) {
                v788t7ScheduleStationFocusWire();
              }
            }, 0);

          v788t7PendingStationUnregisterRef.current.set(
            key,
            pending
          );

          return;
        }

        const pendingUnregister =
          v788t7PendingStationUnregisterRef.current.get(
            key
          );

        if (pendingUnregister != null) {
          clearTimeout(pendingUnregister);

          v788t7PendingStationUnregisterRef.current.delete(
            key
          );
        }

        let tag = 0;

        try {
          tag =
            Number(
              findNodeHandle(node) || 0
            );
        } catch (_) {
          tag = 0;
        }

        if (!tag) {
          return;
        }

        const previousEntry =
          registry.get(key);

        const unchanged =
          previousEntry != null &&
          previousEntry.rowIndex === rowIndex &&
          previousEntry.tag === tag;

        registry.set(
          key,
          {
            key,
            rowIndex,
            tag,
            ref: node,
          }
        );

        if (!unchanged) {
          v788t7ScheduleStationFocusWire();
        }
      },
      [v788t7ScheduleStationFocusWire]
    );

  useEffect(() => {
    return () => {
      if (
        v788t7StationFocusWireTimerRef.current !=
          null
      ) {
        clearTimeout(
          v788t7StationFocusWireTimerRef.current
        );
      }

      for (
        const pending of
          v788t7PendingStationUnregisterRef.current.values()
      ) {
        clearTimeout(pending);
      }

      v788t7PendingStationUnregisterRef.current.clear();
      v788t7StationFocusMapRef.current.clear();
    };
  }, []);

  // V788N4A_DETERMINISTIC_PROGRAM_VERTICAL_FOCUS
  //
  // Up/Down goes exactly one channel row.
  // Prefer the cell covering the same point in time.
  // Otherwise choose the temporally closest cell.
  const v788nWireProgramFocus = useCallback(() => {
    const entries =
      Array.from(
        v788nProgramFocusMapRef.current.values()
      );

    const byRow =
      new Map<number, any[]>();

    for (const entry of entries) {
      const list =
        byRow.get(entry.rowIndex) || [];

      list.push(entry);

      byRow.set(
        entry.rowIndex,
        list
      );
    }

    // V788T8B_NAV_DETERMINISTIC_PROGRAM_ORDER
    for (const list of byRow.values()) {
      list.sort((a, b) => {
        if (a.start !== b.start) {
          return a.start - b.start;
        }

        if (a.end !== b.end) {
          return a.end - b.end;
        }

        return String(a.key).localeCompare(
          String(b.key)
        );
      });
    }

    const pickTarget = (
      sourceEntry: any,
      targetRowIndex: number
    ) => {
      const candidates =
        byRow.get(targetRowIndex) || [];

      if (candidates.length === 0) {
        return null;
      }

      // V788T5C_NO_GUIDE_LEFTMOST_VERTICAL_TARGET
      // A No Guide cell spans the whole timeline and therefore
      // has no meaningful horizontal time anchor. When leaving
      // one vertically, enter the target row at its left-most
      // focusable program instead of inheriting a stale anchor.
      if (
        String(sourceEntry.key || '').startsWith(
          'no-guide:'
        )
      ) {
        let leftmost = candidates[0];

        for (const candidate of candidates) {
          if (
            candidate.start < leftmost.start ||
            (
              candidate.start === leftmost.start &&
              candidate.end < leftmost.end
            )
          ) {
            leftmost = candidate;
          }
        }

        return leftmost;
      }

      const fallbackAnchor =
        (
          sourceEntry.start +
          sourceEntry.end
        ) / 2;

      const rememberedAnchor =
        v788sProgramAnchorRef.current;

      const anchor =
        typeof rememberedAnchor === 'number' &&
        Number.isFinite(rememberedAnchor)
          ? rememberedAnchor
          : fallbackAnchor;

      let best: any = null;

      let bestGap =
        Number.POSITIVE_INFINITY;

      let bestCenterGap =
        Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        let gap = 0;

        if (anchor < candidate.start) {
          gap =
            candidate.start - anchor;
        } else if (anchor > candidate.end) {
          gap =
            anchor - candidate.end;
        }

        const center =
          (
            candidate.start +
            candidate.end
          ) / 2;

        const centerGap =
          Math.abs(
            center - anchor
          );

        if (
          gap < bestGap ||
          (
            gap === bestGap &&
            centerGap < bestCenterGap
          )
        ) {
          best =
            candidate;

          bestGap =
            gap;

          bestCenterGap =
            centerGap;
        }
      }

      return best;
    };

    // V788T8B_NAV_STATION_RIGHT_TO_PROGRAM
    const stationByRow =
      new Map<number, any>();

    for (
      const stationEntry of
        v788t7StationFocusMapRef.current.values()
    ) {
      stationByRow.set(
        stationEntry.rowIndex,
        stationEntry
      );

      const candidates =
        byRow.get(stationEntry.rowIndex) || [];

      const currentTime = Date.now();

      const targetProgram =
        candidates.find(
          (candidate) =>
            candidate.start <= currentTime &&
            currentTime < candidate.end
        ) || candidates[0] || null;

      try {
        stationEntry.ref?.setNativeProps({
          nextFocusRight:
            targetProgram?.tag ||
            stationEntry.tag ||
            undefined,
        });
      } catch (_) {}
    }

    for (const entry of entries) {
      const up =
        pickTarget(
          entry,
          entry.rowIndex - 1
        );

      const down =
        pickTarget(
          entry,
          entry.rowIndex + 1
        );

      // V788T8B_NAV_EXPLICIT_PROGRAM_HORIZONTAL
      const rowEntries =
        byRow.get(entry.rowIndex) || [];

      const rowPosition =
        rowEntries.findIndex(
          (candidate) =>
            candidate.key === entry.key
        );

      const left =
        rowPosition > 0
          ? rowEntries[rowPosition - 1]
          : null;

      const right =
        rowPosition >= 0 &&
        rowPosition < rowEntries.length - 1
          ? rowEntries[rowPosition + 1]
          : null;

      const station =
        stationByRow.get(entry.rowIndex);

      const selfTag =
        entry.tag || undefined;

      const leftTag =
        left?.tag ||
        station?.tag ||
        selfTag;

      // V788T5A_RIGHT_EDGE_FOCUS_TRAP
      const rightTag =
        right?.tag || selfTag;

      try {
        entry.ref?.setNativeProps({
          // V788T8B_NAV_VERTICAL_SELF_TRAP
          nextFocusUp:
            up?.tag || selfTag,

          nextFocusDown:
            down?.tag || selfTag,

          nextFocusLeft:
            leftTag,

          nextFocusRight:
            rightTag,
        });
      } catch (_) {}
    }
  }, []);

  const v788nScheduleProgramFocusWire =
    useCallback(() => {
      if (
        v788nFocusWireTimerRef.current != null
      ) {
        clearTimeout(
          v788nFocusWireTimerRef.current
        );
      }

      v788nFocusWireTimerRef.current =
        setTimeout(() => {
          v788nFocusWireTimerRef.current =
            null;

          v788nWireProgramFocus();
        }, 0);
    }, [v788nWireProgramFocus]);

  const v788nRegisterProgramFocus =
    useCallback(
      (
        key: string,
        rowIndex: number,
        start: number,
        end: number,
        node: any
      ) => {
        const registry =
          v788nProgramFocusMapRef.current;

        if (!node) {
          const priorPending =
            v788t6PendingUnregisterRef.current.get(
              key
            );

          if (priorPending != null) {
            clearTimeout(priorPending);
          }

          const pending =
            setTimeout(() => {
              v788t6PendingUnregisterRef.current.delete(
                key
              );

              const removed =
                registry.delete(key);

              if (removed) {
                v788nScheduleProgramFocusWire();
              }
            }, 0);

          v788t6PendingUnregisterRef.current.set(
            key,
            pending
          );

          return;
        }

        const pendingUnregister =
          v788t6PendingUnregisterRef.current.get(
            key
          );

        if (pendingUnregister != null) {
          clearTimeout(pendingUnregister);
          v788t6PendingUnregisterRef.current.delete(
            key
          );
        }

        let tag = 0;

        try {
          tag =
            Number(
              findNodeHandle(node) || 0
            );
        } catch (_) {
          tag = 0;
        }

        if (!tag) {
          return;
        }

        const previousEntry =
          registry.get(key);

        const unchanged =
          previousEntry != null &&
          previousEntry.rowIndex === rowIndex &&
          previousEntry.start === start &&
          previousEntry.end === end &&
          previousEntry.tag === tag;

        registry.set(
          key,
          {
            key,
            rowIndex,
            start,
            end,
            tag,
            ref: node,
          }
        );

        if (!unchanged) {
          v788nScheduleProgramFocusWire();
        }
      },
      [v788nScheduleProgramFocusWire]
    );

  useEffect(() => {
    return () => {
      if (
        v788nFocusWireTimerRef.current != null
      ) {
        clearTimeout(
          v788nFocusWireTimerRef.current
        );
      }

      for (
        const pending of
          v788t6PendingUnregisterRef.current.values()
      ) {
        clearTimeout(pending);
      }

      v788t6PendingUnregisterRef.current.clear();
      v788nProgramFocusMapRef.current.clear();
    };
  }, []);

  const bu23okEmptyFavorites = !loading && channels.length > 0 &&
    v789gCategory === 'favorites' && v789gVisibleChannels.length === 0;
  const bu23okHasSavedFavorites = Array.from(new Set([
    ...favoriteIds, ...Object.keys(v788t8xFavoriteOverrides),
  ])).some(v788t8xIsFavorite);
  useEffect(() => {
    if (!bu23okEmptyFavorites || !w121zlive123ScreenFocusedRef.current) return;
    v789mCategoryExitPendingRef.current = false;
    v789hCategoryModeRef.current = true;
    setV789hCategoryMode(true);
    setPreferredChannelIndex(-1);
    setV788t8vFocusRestoreRequest({ index: -1, serial: 0 });
    setV789nNativeCategoryPreferredIndex(0);
    setV789nNativeCategoryFocusSerial(value => value + 1);
    console.log('[BU23OK FAVORITES EMPTY] categoryRail=true');
  }, [bu23okEmptyFavorites]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#B8A05C" />
        <Text style={styles.loadingText}>Loading TV guide...</Text>
      </View>
    );
  }

  if (!channels.length) {
    return (
      <View style={styles.center}>
        <Ionicons name="tv-outline" size={64} color="#B8A05C" />
        <Text style={styles.emptyTitle}>No TV channels installed</Text>
        <Text style={styles.emptyText}>
          Install a TV addon from Addons using its manifest link or share code.
        </Text>
      </View>
    );
  }

  const nowX = ((now - timelineStart) / SLOT_MS) * SLOT_WIDTH;

  return (
    <View style={styles.container}>
      {/* V789H_INLINE_LOGO_CATEGORY_ROW */}
      <View
        style={
          styles.v789hTopRow
        }
      >
        <Image
          source={require('../../assets/images/livetv-header-icon.png')}
          style={
            styles.v789hLogo
          }
          resizeMode="contain"
        />

        {/* V789N_NATIVE_CATEGORY_SWITCH */}
        <PrivastreamCategoryRow
          style={{
            flex: 1,
            height: 36, // V789S9_CENTER_CATEGORY_PILLS_WITH_ICON
            marginLeft: 80, // V789S13B_RESTORE_S11_HEADER_GAP
          }}
          items={
            v789nNativeCategoryItems
          }
          itemWidth={156}
          itemHeight={36}
          gap={8}
          leftPadding={4} // V789S13B_FIRST_PILL_SCALE_BLEED_GUARD
          rightPadding={24}
          anchorColumn={5}
          preferredFocusIndex={
            v789nNativeCategoryPreferredIndex
          }
          focusRequest={
            v789nNativeCategoryFocusSerial > 0
              ? `${v789nNativeCategoryPreferredIndex}:${v789nNativeCategoryFocusSerial}`
              : ''
          }
          active={
            v789hCategoryMode
          }
          onItemFocus={
            v789nHandleNativeCategoryFocus
          }
          onItemPress={
            v789nHandleNativeCategoryPress
          }
          onRowBlur={
            v789nHandleNativeCategoryBlur
          }
        />      </View>
            {/* V788T6B_PINNED_GUIDE_HEADER */}
      <View style={styles.guideHeader}>
        <View
          style={[
            styles.stationHeader,
            { width: CHANNEL_WIDTH },
          ]}
        >
          <Text style={styles.stationHeaderText}>
            CHANNEL
          </Text>

          <Text style={styles.stationHeaderClock}>
            {timeLabel(now)}
          </Text>
        </View>

        <ScrollView
          ref={timelineHeaderRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          style={{
            width: Math.max(
              0,
              width - CHANNEL_WIDTH - 48
            ),
          }}
        >
          <View
            style={[
              styles.timelineHeader,
              { width: guideWidth },
            ]}
          >
            {Array.from({
              length: SLOT_COUNT,
            }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.timeSlot,
                  { width: SLOT_WIDTH },
                ]}
              >
                <Text style={styles.timeText}>
                  {timeLabel(
                    timelineStart +
                      i * SLOT_MS
                  )}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* V788T8P_WHOLE_ROW_NATIVE_GUIDE */}
      {bu23okEmptyFavorites ? (
        <View style={styles.center}>
          <Ionicons name="star-outline" size={48} color="#B8A05C" />
          <Text style={styles.emptyTitle}>
            {library === null ? 'Loading favorites...' : bu23okHasSavedFavorites
              ? 'Favorite channels are loading or unavailable' : 'No favorite channels yet'}
          </Text>
          <Text style={styles.emptyText}>
            Choose another category and long-press a station to add it to Favorites.
          </Text>
        </View>
      ) : <PrivastreamLiveTVGuide
        ref={v788y23GuideRef}
        key={`livetv-guide:${v789gCategory}`}
        style={styles.vertical}
        items={v788t8pGuideItems}
        rowHeight={ROW_HEIGHT}
        channelWidth={CHANNEL_WIDTH}
        slotWidth={SLOT_WIDTH}
        slotCount={SLOT_COUNT}
        slotMs={SLOT_MS}
        timelineStartMs={timelineStart}
        nowMs={now}
        preferredFocusIndex={preferredChannelIndex}
        focusRestoreRequest={
          v788t8vFocusRestoreRequest.serial > 0
            ? `${v788t8vFocusRestoreRequest.index}:${v788t8vFocusRestoreRequest.serial}`
            : ''
        }
        onHorizontalScroll={(event: any) => {
          const x = Math.max(
            0,
            Number(
              event?.nativeEvent?.offset || 0
            )
          );

          timelineHeaderRef.current?.scrollTo({
            x,
            animated: false,
          });
        }}
        onItemFocus={(event: any) => {
          // 148G: keep focus bookkeeping frozen during an accepted launch.
          // The native guide remains mounted for exact focus restoration.
          if (w121z148fLaunchRef.current) return;
          const index = Number(
            event?.nativeEvent?.index
          );

          if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= v789gVisibleChannels.length
          ) {
            return;
          }

          const channel = v789gVisibleChannels[index];
          const zone = String(
            event?.nativeEvent?.zone || 'station'
          );

          v788qPreferredFocusArmedRef.current =
            false;

          // V788T8X_DOUBLE_LEFT_STABLE_ARM
          // A native re-report of the same logical focus must not
          // erase the first LEFT before the second LEFT arrives.
          const previousRow =
            v788t8cFocusedRowRef.current;
          const previousArea =
            v788t8cFocusAreaRef.current;

          const logicalFocusChanged =
            previousRow !== index ||
            previousArea !== zone;

          const programToStation =
            previousRow === index &&
            previousArea === 'program' &&
            zone === 'station';

          const stationRowOneToZero =
            previousRow === 1 &&
            previousArea === 'station' &&
            index === 0 &&
            zone === 'station';

          v788t8cFocusedRowRef.current = index;

          if (logicalFocusChanged) {
            v788t8cFirstLeftRef.current = 0;
            v788t8cRawLeftRef.current = 0;

            if (
              v789kSingleLeftTimerRef.current
            ) {
              clearTimeout(
                v789kSingleLeftTimerRef.current
              );

              v789kSingleLeftTimerRef.current =
                null;
            }
          }

          if (programToStation) {
            v789s9ProgramToStationLeftRef.current =
              Date.now();

            console.log(
              '[V789S9 PROGRAM TO STATION] ' +
                'row=' +
                index
            );
          }

          if (stationRowOneToZero) {
            // V789S10_ROW1_TO_ROW0_UP_GUARD
            v789s10RowOneToZeroUpRef.current =
              Date.now();

            console.log(
              '[V789S10 STATION ROW1 TO ROW0] armed'
            );
          }

          if (zone === 'program') {
            v788t8cFocusAreaRef.current = 'program';
            v788pClearStationLongPress();

            const anchor = Number(
              event?.nativeEvent?.anchorMs
            );

            if (Number.isFinite(anchor)) {
              v788sProgramAnchorRef.current =
                anchor;
            }

            v788sLastProgramRowRef.current =
              index;
          } else {
            v788t8cFocusAreaRef.current = 'station';

            v788sProgramAnchorRef.current = null;
            v788sLastProgramRowRef.current = null;

            v788pFocusedStationKeyRef.current =
              channel.key;

            v788pStationLongPressRef.current =
              () => {
                const toggle =
                  v788pToggleFavoriteRef.current;

                if (toggle) {
                  console.log(
                    '[V789I HOLD OK FAVORITE] ' +
                      channel.key
                  );

                  void toggle(channel);
                }
              };

            try {
              v176iRegisterGetter(
                () =>
                  v788pStationLongPressRef.current
              );
            } catch (_) {}
          }

          // V789M_R6_EXIT_COMMIT
          //
          // A native guide child now owns Android focus.
          // It is finally safe to make category buttons
          // non-focusable again.
          if (
            v789mCategoryExitPendingRef.current
          ) {
            v789mCategoryExitPendingRef.current =
              false;

            v789hCategoryModeRef.current =
              false;

            v789hCategoryFocusedIndexRef.current =
              -1;

            setV789hCategoryMode(
              false
            );

            console.log(
              '[V789M EXIT COMMIT] ' +
                'guideRow=' +
                index +
                ' zone=' +
                zone
            );
          }
          console.log('[W121ZEPG161Z NATIVE READY] sinceCommitMs=' +
            (w161zGuideReadyTimeRef.current ? Date.now() - w161zGuideReadyTimeRef.current : -1));
          console.log(
            '[V788T8P NATIVE GUIDE FOCUS] row=' +
              index +
              ' zone=' + zone +
              ' channel=' +
              String(
                channel.item.imdb_id ||
                channel.item.id ||
                channel.name ||
                ''
              )
          );
        }}
        onItemPress={(event: any) => {
          const index = Number(
            event?.nativeEvent?.index
          );

          if (
            Number.isInteger(index) &&
            index >= 0 &&
            index < v789gVisibleChannels.length
          ) {
            void openChannel(
              v789gVisibleChannels[index]
            );
          }
        }}
      />}
      {/* W121ZLIVE148I: full-screen cover is mounted at the app root;
          no screen-owned Modal can flash the EPG on route transition. */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
    paddingHorizontal: 24,
    paddingTop: 18,
  },
  vertical: {
    flex: 1,
    overflow: 'hidden',
  },
  verticalContent: { paddingBottom: 36 },
  center: {
    flex: 1,
    backgroundColor: '#0c0c0c',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  title: {
  color: '#B8A05C',
  fontSize: 30,
  fontWeight: '700',
  marginBottom: 14,
},
  loadingText: { color: '#B8A05C', marginTop: 14 },
  emptyTitle: {
    color: '#B8A05C',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 18,
  },
  emptyText: {
    color: '#B8A05C',
    fontSize: 16,
    marginTop: 8,
    textAlign: 'center',
  },
  // V789H_INLINE_CATEGORY_STYLES
  v789hTopRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    position: 'relative',
  },
  v789hLogo: {
    // V789S6_LARGER_HEADER_ICON
    // 568x358 artwork uses width as the limiting dimension under contain.
    // 64x48 keeps it inside the 52px header while making the visible art
    // substantially larger; V789S11 starts the category row at x=80 for a 16px box gap.
    width: 64,
    height: 48,
    position: 'absolute',
    left: 0,
    top: 2,
    zIndex: 2,
  },
  v789gCategoryRail: {
    flex: 1,
    flexGrow: 1,
    height: 48,
  },
  v789gCategoryRailContent: {
    alignItems: 'center',
    paddingRight: 24,
  },
  v789gCategoryButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    marginRight: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#333',
    backgroundColor: '#171717',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  v789gCategoryButtonSelected: {
    backgroundColor: '#B8A05C',
    borderColor: '#B8A05C',
  },
  v789gCategoryButtonFocused: {
    borderColor: '#ffffff',
    borderWidth: 3,
    transform: [
      { scale: 1.04 },
    ],
  },
  v789gCategoryText: {
    color: '#e5e5e5',
    fontSize: 14,
    fontWeight: '700',
  },
  v789gCategoryTextSelected: {
    color: '#0c0c0c',
  },
  guideHeader: {
    flexDirection: 'row',
    backgroundColor: '#151515',
  },
  guide: { flexDirection: 'row', flex: 1 },
  stationHeader: {
    // W121ZPLAY10Y24F_SEVEN_FULL_ROWS
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#151515',
    borderRightWidth: 1,
    borderColor: '#333',
  },
  stationHeaderText: {
    color: '#999',
    fontSize: 13,
    fontWeight: '700',
  },
  stationHeaderClock: {
    color: '#B8A05C',
    fontSize: 13,
    fontWeight: '700',
  },
  stationRow: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    backgroundColor: '#151515',
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: '#292929',
  },
  stationMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },

  stationBookmarkBadge: {
  backgroundColor: '#B8A05C',
  borderRadius: 4,
  padding: 4,
  marginLeft: 8,
  alignItems: 'center',
  justifyContent: 'center',
},
focused: {
  borderColor: '#B8A05C',
    backgroundColor: 'rgba(184,160,92,0.14)',
  },
  logoBox: {
  width: 84,
  height: 48,
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 8,
},
  logo: {
  width: 80,
  height: 44,
},
  stationText: { flex: 1 },
  stationName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  timelineHeader: {
    position: 'relative',
    height: 36,
    flexDirection: 'row',
    backgroundColor: '#151515',
  },
  timeSlot: {
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRightWidth: 1,
    borderColor: '#333',
  },
  timeText: {
    color: '#bbb',
    fontSize: 13,
    fontWeight: '700',
  },
  programRow: {
    position: 'relative',
    height: ROW_HEIGHT,
    borderTopWidth: 1,
    borderColor: '#292929',
    backgroundColor: '#111',
  },
  program: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#1c1c1c',
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  currentProgram: {
    backgroundColor: 'rgba(184,160,92,0.20)',
  },
  focusedProgram: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184,160,92,0.30)',
  },
  programTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  programTitleNarrow: {
    fontSize: 12,
    lineHeight: 14,
  },
  noGuide: {
    height: ROW_HEIGHT - 8,
    marginTop: 4,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  noGuideText: {
    color: '#666',
    fontSize: 14,
  },
});