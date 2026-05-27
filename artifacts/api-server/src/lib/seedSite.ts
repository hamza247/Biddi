import { db, sitePagesTable, type InsertSitePage, type SitePageContent } from "@workspace/db";
import { logger } from "./logger";

type Lang = "en" | "fr" | "ar";

interface LangPayload {
  title: string;
  heading: string;
  subheading: string;
  metaDescription: string;
  blocks: SitePageContent["blocks"];
}

interface SeedPage {
  slug: string;
  en: LangPayload;
  fr: LangPayload;
  ar: LangPayload;
}

const SEED: SeedPage[] = [
  {
    slug: "home",
    en: {
      title: "BiddiRides — Bid your fare, ride your way",
      heading: "Bid your fare. Ride your way.",
      subheading: "The ride-hailing app where riders propose the price and drivers accept the best offer.",
      metaDescription: "BiddiRides lets riders set the fare and drivers bid for the trip. Faster pickups, fairer prices, available across cities.",
      blocks: [
        { type: "features", title: "Why BiddiRides", items: [
          { icon: "Zap", title: "Fair pricing", description: "You set what you're willing to pay. Drivers decide if it works for them." },
          { icon: "Shield", title: "Verified drivers", description: "Every driver is vetted, background-checked and rated." },
          { icon: "Clock", title: "Fast pickups", description: "Drivers nearby get notified instantly so you ride sooner." },
        ]},
        { type: "steps", title: "How it works", items: [
          { title: "Set your fare", description: "Enter pickup, drop-off, and the price you want to pay." },
          { title: "Drivers bid", description: "Nearby drivers send offers in seconds." },
          { title: "Accept and ride", description: "Pick the offer that suits you and enjoy the trip." },
        ]},
        { type: "testimonials", title: "What riders say", items: [
          { name: "Sara M.", role: "Rider", quote: "Way cheaper than what I used to pay. And drivers are friendly!", rating: 5 },
          { name: "Karim B.", role: "Driver", quote: "I choose which trips to take. Best gig setup I've used.", rating: 5 },
        ]},
        { type: "cta", title: "Ready to ride?", subtitle: "Download the app and try BiddiRides today.", ctaLabel: "Get the app", ctaHref: "#download" },
      ],
    },
    fr: {
      title: "BiddiRides — Misez votre tarif, voyagez à votre façon",
      heading: "Misez votre tarif. Voyagez à votre façon.",
      subheading: "L'application de VTC où les passagers proposent le prix et les chauffeurs acceptent la meilleure offre.",
      metaDescription: "BiddiRides permet aux passagers de fixer le tarif et aux chauffeurs d'enchérir sur la course. Prises en charge plus rapides, prix plus justes.",
      blocks: [
        { type: "features", title: "Pourquoi BiddiRides", items: [
          { icon: "Zap", title: "Prix équitable", description: "Vous définissez ce que vous voulez payer. Les chauffeurs décident." },
          { icon: "Shield", title: "Chauffeurs vérifiés", description: "Chaque chauffeur est contrôlé et noté par les passagers." },
          { icon: "Clock", title: "Prise en charge rapide", description: "Les chauffeurs à proximité sont notifiés instantanément." },
        ]},
        { type: "steps", title: "Comment ça marche", items: [
          { title: "Fixez votre tarif", description: "Entrez le départ, l'arrivée et le prix que vous souhaitez." },
          { title: "Les chauffeurs enchérissent", description: "Les chauffeurs à proximité envoient des offres en quelques secondes." },
          { title: "Acceptez et partez", description: "Choisissez l'offre qui vous convient et profitez du trajet." },
        ]},
        { type: "testimonials", title: "Ce qu'ils disent", items: [
          { name: "Sara M.", role: "Passagère", quote: "Bien moins cher que ce que je payais avant. Et les chauffeurs sont sympas !", rating: 5 },
          { name: "Karim B.", role: "Chauffeur", quote: "Je choisis mes courses. La meilleure expérience que j'aie eue.", rating: 5 },
        ]},
        { type: "cta", title: "Prêt à rouler ?", subtitle: "Téléchargez l'application et essayez BiddiRides.", ctaLabel: "Obtenir l'application", ctaHref: "#download" },
      ],
    },
    ar: {
      title: "BiddiRides — حدّد سعرك وتنقّل بطريقتك",
      heading: "حدّد سعر رحلتك. تنقّل بطريقتك.",
      subheading: "تطبيق طلب السيارات حيث يقترح الركاب السعر ويقبل السائقون أفضل عرض.",
      metaDescription: "يتيح BiddiRides للركاب تحديد السعر وللسائقين تقديم عروضهم على الرحلة. التقاط أسرع وأسعار أكثر إنصافًا في عدة مدن.",
      blocks: [
        { type: "features", title: "لماذا BiddiRides", items: [
          { icon: "Zap", title: "تسعير عادل", description: "أنت تحدد المبلغ الذي ترغب بدفعه، والسائق يقرر ما إذا كان مناسبًا له." },
          { icon: "Shield", title: "سائقون موثّقون", description: "كل سائق يخضع للتحقق ومراجعة السوابق والتقييم." },
          { icon: "Clock", title: "التقاط سريع", description: "يتم إعلام السائقين القريبين فورًا لتنطلق رحلتك بسرعة." },
        ]},
        { type: "steps", title: "كيف يعمل", items: [
          { title: "حدّد سعرك", description: "أدخل نقطة الانطلاق والوصول والسعر الذي ترغب بدفعه." },
          { title: "السائقون يقدّمون عروضهم", description: "يرسل السائقون القريبون عروضهم خلال ثوانٍ." },
          { title: "اقبل وانطلق", description: "اختر العرض المناسب واستمتع برحلتك." },
        ]},
        { type: "testimonials", title: "آراء الركاب", items: [
          { name: "سارة م.", role: "راكبة", quote: "أرخص بكثير مما كنت أدفع. والسائقون ودودون!", rating: 5 },
          { name: "كريم ب.", role: "سائق", quote: "أختار الرحلات التي تناسبني. أفضل تجربة عمل مرّت عليّ.", rating: 5 },
        ]},
        { type: "cta", title: "جاهز للانطلاق؟", subtitle: "حمّل التطبيق وجرّب BiddiRides اليوم.", ctaLabel: "حمّل التطبيق", ctaHref: "#download" },
      ],
    },
  },
  {
    slug: "about",
    en: {
      title: "About BiddiRides",
      heading: "Built for fairer rides",
      subheading: "We believe pricing transparency creates a better marketplace for riders and drivers.",
      metaDescription: "Learn about the BiddiRides mission, team, and the bid-based ride model that puts riders and drivers in control.",
      blocks: [
        { type: "richtext", html: "<p>BiddiRides is a new kind of ride-hailing platform. Riders propose what they want to pay, and drivers near them bid to accept the trip. The result: better prices, faster matches, and a marketplace that respects both sides.</p>" },
        { type: "features", title: "Our values", items: [
          { icon: "Heart", title: "People first", description: "Riders and drivers come before metrics." },
          { icon: "Shield", title: "Trust", description: "Verified profiles, transparent pricing, fair ratings." },
          { icon: "Globe", title: "Local impact", description: "We grow city by city, with the community." },
        ]},
      ],
    },
    fr: {
      title: "À propos de BiddiRides",
      heading: "Conçu pour des trajets plus équitables",
      subheading: "Nous croyons que la transparence des prix crée un meilleur marché.",
      metaDescription: "Découvrez la mission de BiddiRides, l'équipe et le modèle de course par enchères.",
      blocks: [
        { type: "richtext", html: "<p>BiddiRides est une nouvelle plateforme de VTC. Les passagers proposent leur prix et les chauffeurs à proximité enchérissent pour accepter le trajet.</p>" },
        { type: "features", title: "Nos valeurs", items: [
          { icon: "Heart", title: "Les gens d'abord", description: "Passagers et chauffeurs avant les métriques." },
          { icon: "Shield", title: "Confiance", description: "Profils vérifiés, prix transparents, notes équitables." },
          { icon: "Globe", title: "Impact local", description: "Nous grandissons ville par ville." },
        ]},
      ],
    },
    ar: {
      title: "عن BiddiRides",
      heading: "صُمِّم من أجل رحلات أكثر إنصافًا",
      subheading: "نؤمن بأن شفافية الأسعار تخلق سوقًا أفضل للركاب والسائقين.",
      metaDescription: "تعرّف على رسالة BiddiRides وفريقها ونموذج المزايدة الذي يضع الركاب والسائقين في موضع التحكم.",
      blocks: [
        { type: "richtext", html: "<p>BiddiRides منصة جديدة لطلب السيارات. يقترح الركاب السعر الذي يرغبون بدفعه، ويقدّم السائقون القريبون عروضهم لقبول الرحلة. النتيجة: أسعار أفضل، توافق أسرع، وسوق يحترم الطرفين.</p>" },
        { type: "features", title: "قيمنا", items: [
          { icon: "Heart", title: "الإنسان أولًا", description: "الركاب والسائقون قبل الأرقام." },
          { icon: "Shield", title: "الثقة", description: "ملفات موثّقة، أسعار شفافة، وتقييمات عادلة." },
          { icon: "Globe", title: "أثر محلي", description: "ننمو مدينة تلو الأخرى مع المجتمع." },
        ]},
      ],
    },
  },
  {
    slug: "contact",
    en: {
      title: "Contact us",
      heading: "Get in touch",
      subheading: "Questions, partnerships, press — we'd love to hear from you.",
      metaDescription: "Reach the BiddiRides team for support, press, partnerships, or feedback.",
      blocks: [],
    },
    fr: {
      title: "Nous contacter",
      heading: "Contactez-nous",
      subheading: "Questions, partenariats, presse — écrivez-nous.",
      metaDescription: "Contactez l'équipe BiddiRides pour le support, la presse, les partenariats ou vos retours.",
      blocks: [],
    },
    ar: {
      title: "اتصل بنا",
      heading: "تواصل معنا",
      subheading: "الأسئلة، الشراكات، الصحافة — يسعدنا تواصلك معنا.",
      metaDescription: "تواصل مع فريق BiddiRides للدعم، الصحافة، الشراكات أو الملاحظات.",
      blocks: [],
    },
  },
  {
    slug: "faq",
    en: {
      title: "FAQ",
      heading: "Frequently asked questions",
      subheading: "Quick answers about pricing, drivers, payment and safety.",
      metaDescription: "Answers about how BiddiRides bidding works, payment methods, driver vetting, and trip safety.",
      blocks: [
        { type: "faq", items: [
          { question: "How does the bid system work?", answer: "You enter your trip and the price you want. Drivers nearby send offers and you pick one." },
          { question: "Can drivers accept any fare?", answer: "Drivers see your offer and accept only if it works for them — that's what makes pricing fair." },
          { question: "What payment methods are supported?", answer: "Cash and in-app card payments depending on your city." },
          { question: "Are drivers verified?", answer: "Yes — ID checks, document verification and continuous rating." },
          { question: "What if no driver accepts?", answer: "Increase your offer or try a different time. The app will guide you." },
        ]},
      ],
    },
    fr: {
      title: "FAQ",
      heading: "Questions fréquentes",
      subheading: "Réponses sur les prix, chauffeurs, paiement et sécurité.",
      metaDescription: "Réponses sur les enchères BiddiRides, les paiements, la vérification des chauffeurs et la sécurité.",
      blocks: [
        { type: "faq", items: [
          { question: "Comment fonctionnent les enchères ?", answer: "Vous saisissez le trajet et le prix souhaité. Les chauffeurs envoient des offres et vous choisissez." },
          { question: "Les chauffeurs peuvent-ils accepter n'importe quel tarif ?", answer: "Les chauffeurs ne voient que les offres qui leur conviennent." },
          { question: "Quels paiements sont acceptés ?", answer: "Espèces et carte selon votre ville." },
          { question: "Les chauffeurs sont-ils vérifiés ?", answer: "Oui — pièces d'identité, documents et notation continue." },
          { question: "Que se passe-t-il si aucun chauffeur n'accepte ?", answer: "Augmentez votre offre ou essayez à un autre moment." },
        ]},
      ],
    },
    ar: {
      title: "الأسئلة الشائعة",
      heading: "الأسئلة المتكررة",
      subheading: "إجابات سريعة حول الأسعار والسائقين والدفع والأمان.",
      metaDescription: "إجابات حول طريقة عمل المزايدة في BiddiRides، وسائل الدفع، توثيق السائقين، وأمان الرحلات.",
      blocks: [
        { type: "faq", items: [
          { question: "كيف يعمل نظام المزايدة؟", answer: "تدخل تفاصيل رحلتك والسعر الذي ترغب به، فيرسل السائقون القريبون عروضهم وتختار ما يناسبك." },
          { question: "هل يقبل السائقون أي سعر؟", answer: "يرى السائقون عرضك ولا يقبلونه إلا إذا كان مناسبًا لهم — وهذا ما يجعل التسعير عادلًا." },
          { question: "ما طرق الدفع المدعومة؟", answer: "نقدًا أو ببطاقة عبر التطبيق حسب مدينتك." },
          { question: "هل السائقون موثّقون؟", answer: "نعم — تحقق من الهوية والمستندات وتقييم مستمر." },
          { question: "ماذا لو لم يقبل أي سائق؟", answer: "ارفع عرضك قليلًا أو جرّب في وقت آخر، وسيرشدك التطبيق." },
        ]},
      ],
    },
  },
  {
    slug: "help",
    en: {
      title: "Help Center",
      heading: "Help & support",
      subheading: "Find guides for riders and drivers, or contact us for help.",
      metaDescription: "Self-service help articles for BiddiRides riders and drivers.",
      blocks: [
        { type: "richtext", html: "<h3>Riders</h3><ul><li>Booking your first trip</li><li>Updating payment methods</li><li>Contacting your driver</li></ul><h3>Drivers</h3><ul><li>Becoming a driver</li><li>Document upload</li><li>Earnings & withdrawals</li></ul>" },
      ],
    },
    fr: {
      title: "Centre d'aide",
      heading: "Aide & support",
      subheading: "Guides pour passagers et chauffeurs, ou contactez-nous.",
      metaDescription: "Articles d'aide en libre-service pour les utilisateurs BiddiRides.",
      blocks: [
        { type: "richtext", html: "<h3>Passagers</h3><ul><li>Réserver votre premier trajet</li><li>Mettre à jour le paiement</li><li>Contacter votre chauffeur</li></ul><h3>Chauffeurs</h3><ul><li>Devenir chauffeur</li><li>Téléversement des documents</li><li>Revenus et retraits</li></ul>" },
      ],
    },
    ar: {
      title: "مركز المساعدة",
      heading: "المساعدة والدعم",
      subheading: "أدلة للركاب والسائقين، أو تواصل معنا للحصول على المساعدة.",
      metaDescription: "مقالات مساعدة ذاتية لركاب وسائقي BiddiRides.",
      blocks: [
        { type: "richtext", html: "<h3>الركاب</h3><ul><li>حجز رحلتك الأولى</li><li>تحديث وسائل الدفع</li><li>التواصل مع السائق</li></ul><h3>السائقون</h3><ul><li>كيف تصبح سائقًا</li><li>رفع المستندات</li><li>الأرباح وسحبها</li></ul>" },
      ],
    },
  },
  {
    slug: "how-it-works",
    en: {
      title: "How it works",
      heading: "How BiddiRides works",
      subheading: "From booking to drop-off, here's the flow.",
      metaDescription: "Step-by-step guide to using BiddiRides — for riders and drivers.",
      blocks: [
        { type: "steps", items: [
          { title: "Open the app", description: "Sign up or log in with phone or email." },
          { title: "Enter your trip", description: "Pickup, drop-off, vehicle type." },
          { title: "Set your offer", description: "We suggest a fair price — change it as you wish." },
          { title: "Receive bids", description: "Drivers respond in real time." },
          { title: "Confirm and ride", description: "Pick the driver, track them, enjoy your trip." },
        ]},
      ],
    },
    fr: {
      title: "Comment ça marche",
      heading: "Comment fonctionne BiddiRides",
      subheading: "De la réservation à l'arrivée, voici le déroulement.",
      metaDescription: "Guide étape par étape pour utiliser BiddiRides.",
      blocks: [
        { type: "steps", items: [
          { title: "Ouvrez l'application", description: "Inscrivez-vous ou connectez-vous." },
          { title: "Saisissez votre trajet", description: "Départ, arrivée, type de véhicule." },
          { title: "Définissez votre offre", description: "Nous suggérons un prix juste." },
          { title: "Recevez les offres", description: "Les chauffeurs répondent en temps réel." },
          { title: "Confirmez et partez", description: "Choisissez le chauffeur, suivez-le, profitez." },
        ]},
      ],
    },
    ar: {
      title: "كيف يعمل",
      heading: "كيف يعمل BiddiRides",
      subheading: "من الحجز حتى الوصول، إليك الخطوات.",
      metaDescription: "دليل خطوة بخطوة لاستخدام BiddiRides — للركاب والسائقين.",
      blocks: [
        { type: "steps", items: [
          { title: "افتح التطبيق", description: "أنشئ حسابًا أو سجّل دخولك بالهاتف أو البريد الإلكتروني." },
          { title: "أدخل تفاصيل رحلتك", description: "نقطة الانطلاق والوصول ونوع المركبة." },
          { title: "حدّد عرضك", description: "نقترح عليك سعرًا عادلًا — يمكنك تعديله كما تشاء." },
          { title: "استلم العروض", description: "يرد السائقون في الوقت الحقيقي." },
          { title: "أكّد وانطلق", description: "اختر السائق وتابع موقعه واستمتع برحلتك." },
        ]},
      ],
    },
  },
  {
    slug: "intercity",
    en: {
      title: "Intercity rides",
      heading: "Travel between cities",
      subheading: "Book a long-distance trip and let drivers bid for it.",
      metaDescription: "Travel between cities with BiddiRides — comfortable cars, transparent pricing, vetted drivers.",
      blocks: [
        { type: "features", items: [
          { icon: "MapPin", title: "Door to door", description: "No transfers, no terminals — pickup at home." },
          { icon: "Clock", title: "On your schedule", description: "Pick the time and date that suit you." },
          { icon: "Wallet", title: "Best price", description: "Drivers compete for your trip." },
        ]},
      ],
    },
    fr: {
      title: "Trajets interurbains",
      heading: "Voyagez entre les villes",
      subheading: "Réservez un long trajet et laissez les chauffeurs enchérir.",
      metaDescription: "Voyagez entre villes avec BiddiRides — voitures confortables, prix transparents.",
      blocks: [
        { type: "features", items: [
          { icon: "MapPin", title: "Porte à porte", description: "Pas de correspondances, pas de gares." },
          { icon: "Clock", title: "À votre horaire", description: "Choisissez la date et l'heure." },
          { icon: "Wallet", title: "Meilleur prix", description: "Les chauffeurs se concurrencent." },
        ]},
      ],
    },
    ar: {
      title: "رحلات بين المدن",
      heading: "تنقّل بين المدن",
      subheading: "احجز رحلة طويلة المسافة ودع السائقين يقدّمون عروضهم.",
      metaDescription: "تنقّل بين المدن مع BiddiRides — سيارات مريحة، أسعار شفافة، وسائقون موثّقون.",
      blocks: [
        { type: "features", items: [
          { icon: "MapPin", title: "من الباب إلى الباب", description: "لا حاجة للمحطات أو التنقلات — يبدأ التقاطك من منزلك." },
          { icon: "Clock", title: "وفق جدولك", description: "اختر التاريخ والوقت المناسبَين لك." },
          { icon: "Wallet", title: "أفضل سعر", description: "السائقون يتنافسون على رحلتك." },
        ]},
      ],
    },
  },
  {
    slug: "rental-packages",
    en: {
      title: "Rental packages",
      heading: "Rent a driver by the hour",
      subheading: "Hourly and daily packages with a dedicated driver.",
      metaDescription: "Hourly and daily car-with-driver packages from BiddiRides — perfect for events, errands, or city tours.",
      blocks: [
        { type: "features", items: [
          { icon: "Clock", title: "Flexible duration", description: "From 2 hours to a full day." },
          { icon: "Star", title: "Top-rated drivers", description: "Hand-picked for rentals." },
          { icon: "Car", title: "Comfort vehicles", description: "Sedans and SUVs available." },
        ]},
      ],
    },
    fr: {
      title: "Forfaits location",
      heading: "Réservez un chauffeur à l'heure",
      subheading: "Forfaits horaires et journaliers avec chauffeur dédié.",
      metaDescription: "Forfaits voiture avec chauffeur à l'heure ou à la journée — idéal pour événements ou visites.",
      blocks: [
        { type: "features", items: [
          { icon: "Clock", title: "Durée flexible", description: "De 2 heures à une journée entière." },
          { icon: "Star", title: "Chauffeurs notés", description: "Sélectionnés pour les locations." },
          { icon: "Car", title: "Véhicules confort", description: "Berlines et SUV disponibles." },
        ]},
      ],
    },
    ar: {
      title: "باقات التأجير",
      heading: "استأجر سائقًا بالساعة",
      subheading: "باقات بالساعة وباليوم مع سائق مخصّص.",
      metaDescription: "باقات سيارة مع سائق بالساعة أو باليوم من BiddiRides — مثالية للفعاليات أو المهام أو الجولات داخل المدينة.",
      blocks: [
        { type: "features", items: [
          { icon: "Clock", title: "مدة مرنة", description: "من ساعتين حتى يوم كامل." },
          { icon: "Star", title: "سائقون بأعلى التقييمات", description: "يتم اختيارهم بعناية لخدمة التأجير." },
          { icon: "Car", title: "مركبات مريحة", description: "سيارات سيدان ودفع رباعي متوفرة." },
        ]},
      ],
    },
  },
  {
    slug: "trust-safety",
    en: {
      title: "Trust & Safety",
      heading: "Your safety, end to end",
      subheading: "Verified drivers, in-app safety tools, 24/7 support.",
      metaDescription: "BiddiRides safety: verified drivers, SOS button, trip sharing, and 24/7 incident support.",
      blocks: [
        { type: "features", items: [
          { icon: "Shield", title: "Verified drivers", description: "ID and document checks for every driver." },
          { icon: "Bell", title: "SOS button", description: "Reach emergency contacts in two taps." },
          { icon: "Share2", title: "Trip sharing", description: "Share your live location with loved ones." },
        ]},
      ],
    },
    fr: {
      title: "Confiance et sécurité",
      heading: "Votre sécurité, de bout en bout",
      subheading: "Chauffeurs vérifiés, outils de sécurité, support 24/7.",
      metaDescription: "Sécurité BiddiRides : chauffeurs vérifiés, bouton SOS, partage de trajet et support 24/7.",
      blocks: [
        { type: "features", items: [
          { icon: "Shield", title: "Chauffeurs vérifiés", description: "Vérification d'identité pour chaque chauffeur." },
          { icon: "Bell", title: "Bouton SOS", description: "Joignez vos contacts d'urgence en deux taps." },
          { icon: "Share2", title: "Partage de trajet", description: "Partagez votre position en direct." },
        ]},
      ],
    },
    ar: {
      title: "الثقة والأمان",
      heading: "أمانك من البداية إلى النهاية",
      subheading: "سائقون موثّقون، أدوات أمان داخل التطبيق، ودعم على مدار الساعة.",
      metaDescription: "الأمان في BiddiRides: سائقون موثّقون، زر طوارئ، مشاركة الرحلة، ودعم للحوادث على مدار الساعة.",
      blocks: [
        { type: "features", items: [
          { icon: "Shield", title: "سائقون موثّقون", description: "التحقق من الهوية والمستندات لكل سائق." },
          { icon: "Bell", title: "زر الطوارئ", description: "تواصل مع جهات الطوارئ بنقرتين." },
          { icon: "Share2", title: "مشاركة الرحلة", description: "شارك موقعك المباشر مع من تحب." },
        ]},
      ],
    },
  },
  {
    slug: "safety-guidelines",
    en: {
      title: "Safety guidelines",
      heading: "Riding safely with BiddiRides",
      subheading: "Tips for riders and drivers to stay safe at every step.",
      metaDescription: "Safety guidelines and best practices for BiddiRides riders and drivers.",
      blocks: [
        { type: "richtext", html: "<h3>Before the ride</h3><ul><li>Check the license plate and driver photo</li><li>Wait in a safe, public place</li></ul><h3>During the ride</h3><ul><li>Wear your seatbelt</li><li>Share your trip with a friend</li></ul><h3>After the ride</h3><ul><li>Rate honestly</li><li>Report any issue from the trip details screen</li></ul>" },
      ],
    },
    fr: {
      title: "Consignes de sécurité",
      heading: "Voyager en toute sécurité",
      subheading: "Conseils pour rester en sécurité.",
      metaDescription: "Consignes et bonnes pratiques de sécurité pour BiddiRides.",
      blocks: [
        { type: "richtext", html: "<h3>Avant la course</h3><ul><li>Vérifiez la plaque et la photo</li><li>Attendez dans un lieu sûr</li></ul><h3>Pendant la course</h3><ul><li>Mettez votre ceinture</li><li>Partagez votre trajet</li></ul><h3>Après la course</h3><ul><li>Notez honnêtement</li><li>Signalez tout problème depuis les détails du trajet</li></ul>" },
      ],
    },
    ar: {
      title: "إرشادات السلامة",
      heading: "تنقّل بأمان مع BiddiRides",
      subheading: "نصائح للركاب والسائقين للبقاء آمنين في كل خطوة.",
      metaDescription: "إرشادات وأفضل ممارسات السلامة لركاب وسائقي BiddiRides.",
      blocks: [
        { type: "richtext", html: "<h3>قبل الرحلة</h3><ul><li>تحقّق من لوحة السيارة وصورة السائق</li><li>انتظر في مكان آمن وعام</li></ul><h3>أثناء الرحلة</h3><ul><li>اربط حزام الأمان</li><li>شارك تفاصيل رحلتك مع صديق</li></ul><h3>بعد الرحلة</h3><ul><li>قيّم بصدق</li><li>أبلغ عن أي مشكلة من شاشة تفاصيل الرحلة</li></ul>" },
      ],
    },
  },
  {
    slug: "insurance",
    en: {
      title: "Insurance",
      heading: "Insurance coverage",
      subheading: "Every BiddiRides trip is covered by a commercial liability and on-trip accident policy.",
      metaDescription: "Insurance coverage on every BiddiRides trip: liability, on-trip accident, and rider protection.",
      blocks: [
        { type: "features", items: [
          { icon: "Shield", title: "Liability", description: "Third-party liability for every active trip." },
          { icon: "Heart", title: "Accident cover", description: "Medical and disability cover for riders and drivers in a covered incident." },
          { icon: "FileText", title: "Claims support", description: "Dedicated team to help you file and follow up on claims." },
        ]},
        { type: "richtext", html: "<p>Coverage applies from the moment a trip is accepted until drop-off. Specific limits and conditions are listed in the policy summary available on request from <a href=\"/en/contact\">support</a>.</p>" },
      ],
    },
    fr: {
      title: "Assurance",
      heading: "Couverture d'assurance",
      subheading: "Chaque trajet BiddiRides est couvert par une assurance responsabilité civile et accident.",
      metaDescription: "Couverture d'assurance sur chaque trajet BiddiRides : responsabilité civile, accident en course, protection passager.",
      blocks: [
        { type: "features", items: [
          { icon: "Shield", title: "Responsabilité civile", description: "RC pour chaque trajet actif." },
          { icon: "Heart", title: "Accident", description: "Couverture médicale pour passagers et chauffeurs en cas d'incident couvert." },
          { icon: "FileText", title: "Support sinistres", description: "Une équipe dédiée pour vos déclarations." },
        ]},
        { type: "richtext", html: "<p>La couverture s'applique de l'acceptation du trajet jusqu'à la dépose. Les conditions précises sont disponibles auprès du <a href=\"/fr/contact\">support</a>.</p>" },
      ],
    },
    ar: {
      title: "التأمين",
      heading: "تغطية التأمين",
      subheading: "كل رحلة في BiddiRides مغطّاة بتأمين مسؤولية تجارية وتأمين حوادث أثناء الرحلة.",
      metaDescription: "تغطية تأمينية على كل رحلة في BiddiRides: المسؤولية، الحوادث أثناء الرحلة، وحماية الراكب.",
      blocks: [
        { type: "features", items: [
          { icon: "Shield", title: "المسؤولية", description: "تأمين مسؤولية تجاه الغير لكل رحلة نشطة." },
          { icon: "Heart", title: "تغطية الحوادث", description: "تغطية طبية وعجز للركاب والسائقين عند وقوع حادث مشمول." },
          { icon: "FileText", title: "دعم المطالبات", description: "فريق مخصّص لمساعدتك في تقديم المطالبات ومتابعتها." },
        ]},
        { type: "richtext", html: "<p>تسري التغطية منذ لحظة قبول الرحلة وحتى إنزال الراكب. الحدود والشروط التفصيلية متاحة في ملخص الوثيقة عند الطلب من <a href=\"/ar/contact\">الدعم</a>.</p>" },
      ],
    },
  },
  {
    slug: "privacy",
    en: {
      title: "Privacy Policy",
      heading: "Privacy Policy",
      subheading: "How we collect, use and protect your data.",
      metaDescription: "How BiddiRides collects, uses and protects personal data.",
      blocks: [
        { type: "richtext", html: "<h2>Information we collect</h2><p>We collect account, trip, payment and device information to operate the BiddiRides service.</p><h2>How we use it</h2><p>To match riders and drivers, process payments, prevent fraud and improve the product.</p><h2>Sharing</h2><p>We share data only as required to operate the service or comply with the law.</p><h2>Your rights</h2><p>You can request access, correction or deletion of your data at any time.</p>" },
      ],
    },
    fr: {
      title: "Politique de confidentialité",
      heading: "Politique de confidentialité",
      subheading: "Comment nous collectons et protégeons vos données.",
      metaDescription: "Comment BiddiRides collecte et protège les données personnelles.",
      blocks: [
        { type: "richtext", html: "<h2>Informations collectées</h2><p>Nous collectons les informations de compte, trajet, paiement et appareil.</p><h2>Utilisation</h2><p>Pour mettre en relation passagers et chauffeurs, traiter les paiements et améliorer le service.</p><h2>Partage</h2><p>Uniquement quand cela est nécessaire ou exigé par la loi.</p><h2>Vos droits</h2><p>Accès, rectification, suppression à tout moment.</p>" },
      ],
    },
    ar: {
      title: "سياسة الخصوصية",
      heading: "سياسة الخصوصية",
      subheading: "كيف نجمع بياناتك ونستخدمها ونحميها.",
      metaDescription: "كيف يجمع BiddiRides البيانات الشخصية ويستخدمها ويحميها.",
      blocks: [
        { type: "richtext", html: "<h2>المعلومات التي نجمعها</h2><p>نجمع معلومات الحساب والرحلة والدفع والجهاز لتشغيل خدمة BiddiRides.</p><h2>كيف نستخدمها</h2><p>للربط بين الركاب والسائقين، ومعالجة المدفوعات، ومنع الاحتيال، وتحسين المنتج.</p><h2>المشاركة</h2><p>نشارك البيانات فقط بالقدر اللازم لتشغيل الخدمة أو للامتثال للقانون.</p><h2>حقوقك</h2><p>يمكنك طلب الوصول إلى بياناتك أو تصحيحها أو حذفها في أي وقت.</p>" },
      ],
    },
  },
  {
    slug: "terms",
    en: {
      title: "Terms of Service",
      heading: "Terms of Service",
      subheading: "The rules for using BiddiRides.",
      metaDescription: "Terms of service governing the use of the BiddiRides app and platform.",
      blocks: [
        { type: "richtext", html: "<p>By using BiddiRides you agree to these terms. The app connects riders with independent drivers; BiddiRides is the technology platform.</p>" },
      ],
    },
    fr: {
      title: "Conditions d'utilisation",
      heading: "Conditions d'utilisation",
      subheading: "Les règles d'utilisation de BiddiRides.",
      metaDescription: "Conditions d'utilisation de l'application et de la plateforme BiddiRides.",
      blocks: [
        { type: "richtext", html: "<p>En utilisant BiddiRides vous acceptez ces conditions. L'application met en relation passagers et chauffeurs indépendants.</p>" },
      ],
    },
    ar: {
      title: "شروط الخدمة",
      heading: "شروط الخدمة",
      subheading: "قواعد استخدام BiddiRides.",
      metaDescription: "شروط الخدمة التي تحكم استخدام تطبيق ومنصة BiddiRides.",
      blocks: [
        { type: "richtext", html: "<p>باستخدامك BiddiRides فإنك توافق على هذه الشروط. يربط التطبيق بين الركاب والسائقين المستقلين؛ وBiddiRides هي المنصة التقنية.</p>" },
      ],
    },
  },
  {
    slug: "legal",
    en: {
      title: "Legal",
      heading: "Legal information",
      subheading: "Company info and legal notices.",
      metaDescription: "Legal information for BiddiRides operations.",
      blocks: [
        { type: "richtext", html: "<p>BiddiRides operates the BiddiRides ride-hailing platform.</p>" },
      ],
    },
    fr: {
      title: "Mentions légales",
      heading: "Mentions légales",
      subheading: "Informations sur la société et avis légaux.",
      metaDescription: "Mentions légales BiddiRides.",
      blocks: [
        { type: "richtext", html: "<p>BiddiRides exploite la plateforme BiddiRides.</p>" },
      ],
    },
    ar: {
      title: "إشعارات قانونية",
      heading: "المعلومات القانونية",
      subheading: "معلومات عن الشركة والإشعارات القانونية.",
      metaDescription: "معلومات قانونية حول عمليات BiddiRides.",
      blocks: [
        { type: "richtext", html: "<p>تشغّل BiddiRides منصة BiddiRides لطلب السيارات.</p>" },
      ],
    },
  },
  {
    slug: "signin",
    en: {
      title: "Sign in",
      heading: "Welcome back",
      subheading: "Sign in to manage your account.",
      metaDescription: "Sign in to your BiddiRides account.",
      blocks: [],
    },
    fr: {
      title: "Connexion",
      heading: "Bon retour",
      subheading: "Connectez-vous pour gérer votre compte.",
      metaDescription: "Connectez-vous à votre compte BiddiRides.",
      blocks: [],
    },
    ar: {
      title: "تسجيل الدخول",
      heading: "مرحبًا بعودتك",
      subheading: "سجّل الدخول لإدارة حسابك.",
      metaDescription: "سجّل الدخول إلى حسابك في BiddiRides.",
      blocks: [],
    },
  },
  {
    slug: "signup",
    en: {
      title: "Create account",
      heading: "Create your BiddiRides account",
      subheading: "It only takes a minute.",
      metaDescription: "Create a BiddiRides account to start booking rides at fair prices.",
      blocks: [],
    },
    fr: {
      title: "Créer un compte",
      heading: "Créez votre compte BiddiRides",
      subheading: "Cela prend une minute.",
      metaDescription: "Créez un compte BiddiRides pour commencer à réserver vos trajets.",
      blocks: [],
    },
    ar: {
      title: "إنشاء حساب",
      heading: "أنشئ حسابك في BiddiRides",
      subheading: "لن يستغرق الأمر سوى دقيقة.",
      metaDescription: "أنشئ حسابًا في BiddiRides لتبدأ بحجز رحلاتك بأسعار عادلة.",
      blocks: [],
    },
  },
  {
    slug: "forgot-password",
    en: {
      title: "Forgot password",
      heading: "Reset your password",
      subheading: "We'll send you a code to verify your identity.",
      metaDescription: "Reset your BiddiRides password using your email address.",
      blocks: [],
    },
    fr: {
      title: "Mot de passe oublié",
      heading: "Réinitialiser votre mot de passe",
      subheading: "Nous vous enverrons un code de vérification.",
      metaDescription: "Réinitialisez votre mot de passe BiddiRides via votre email.",
      blocks: [],
    },
    ar: {
      title: "نسيت كلمة المرور",
      heading: "إعادة تعيين كلمة المرور",
      subheading: "سنرسل إليك رمزًا للتحقق من هويتك.",
      metaDescription: "أعد تعيين كلمة مرور BiddiRides باستخدام بريدك الإلكتروني.",
      blocks: [],
    },
  },
  {
    slug: "maintenance",
    en: {
      title: "We'll be back soon",
      heading: "Maintenance in progress",
      subheading: "BiddiRides is undergoing scheduled improvements. Thanks for your patience.",
      metaDescription: "BiddiRides is undergoing maintenance. We'll be back shortly.",
      blocks: [],
    },
    fr: {
      title: "Nous revenons bientôt",
      heading: "Maintenance en cours",
      subheading: "BiddiRides est en cours d'amélioration. Merci de votre patience.",
      metaDescription: "BiddiRides est en maintenance.",
      blocks: [],
    },
    ar: {
      title: "سنعود قريبًا",
      heading: "أعمال الصيانة جارية",
      subheading: "تخضع BiddiRides حاليًا لتحسينات مجدولة. شكرًا لصبرك.",
      metaDescription: "تخضع BiddiRides للصيانة. سنعود قريبًا.",
      blocks: [],
    },
  },
  {
    slug: "404",
    en: {
      title: "Page not found",
      heading: "Page not found",
      subheading: "The page you were looking for doesn't exist.",
      metaDescription: "The page you requested could not be found.",
      blocks: [],
    },
    fr: {
      title: "Page introuvable",
      heading: "Page introuvable",
      subheading: "La page recherchée n'existe pas.",
      metaDescription: "La page demandée est introuvable.",
      blocks: [],
    },
    ar: {
      title: "الصفحة غير موجودة",
      heading: "الصفحة غير موجودة",
      subheading: "الصفحة التي تبحث عنها غير موجودة.",
      metaDescription: "تعذّر العثور على الصفحة المطلوبة.",
      blocks: [],
    },
  },
];

const LANGS: readonly Lang[] = ["en", "fr", "ar"] as const;

export async function ensureSitePagesSeeded(): Promise<void> {
  try {
    const existing = await db.select({ slug: sitePagesTable.slug, lang: sitePagesTable.lang }).from(sitePagesTable);
    const existingSet = new Set(existing.map((r) => `${r.slug}:${r.lang}`));
    const inserts: InsertSitePage[] = [];
    for (const seed of SEED) {
      for (const lang of LANGS) {
        const key = `${seed.slug}:${lang}`;
        if (existingSet.has(key)) continue;
        const payload = seed[lang];
        inserts.push({
          slug: seed.slug,
          lang,
          status: "published",
          title: payload.title,
          content: {
            heading: payload.heading,
            subheading: payload.subheading,
            blocks: payload.blocks,
          },
          metaTitle: payload.title,
          metaDescription: payload.metaDescription,
          twitterCard: "summary_large_image",
          robotsIndex: seed.slug !== "404" && seed.slug !== "maintenance",
        });
      }
    }
    if (inserts.length > 0) {
      await db.insert(sitePagesTable).values(inserts);
      logger.info({ count: inserts.length }, "[siteSeed] inserted default site pages");
    } else {
      logger.info("[siteSeed] all default site pages already present");
    }
  } catch (err) {
    logger.error({ err }, "[siteSeed] failed to seed site pages");
  }
}
