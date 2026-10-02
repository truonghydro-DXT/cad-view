<template>
	<MlCadViewer
		:url="viewerUrl"
		locale="en"
		:mode="AcEdOpenMode.Write"
		:base-url="resolvedBaseUrl"
		:use-main-thread-draw="useMainThreadDraw"
		@create="handleViewerCreate"
	/>
</template>

<script setup lang="ts">
import { AcApSettingManager, AcApDocument, AcApDocManager, AcEdOpenMode, eventBus } from '@mlightcad/cad-simple-viewer'
import { MlCadViewer } from '@mlightcad/cad-viewer'
import { AcDbDatabase, AcDbMText, AcDbText } from '@mlightcad/data-model'
import { computed, watch } from 'vue'
import { detectCharset, toUnicode } from 'vietnamese-conversion'

import { applyCadPerformanceSettings, applyCadRenderOptimizations } from './utils/cadPerformance'
import type { LargeFileSettings } from './utils/largeFileMode'

type FontManifestEntry = {
	file?: string
	name?: string[]
	type?: string
}

type LegacyCharset = 'vni' | 'tcvn3'

type LegacyStyleRule = {
	pattern: RegExp
	charset: LegacyCharset
	fallbackSlot: 'default' | 'tcvn3' | 'vni'
}

const HARD_STYLE_NAME_RULES: LegacyStyleRule[] = [
	{ pattern: /(^|[_.\-\s])vni([_.\-\s]|$)|vn_vni|vni-times|vni-helve|vnarial|vntimeh/i, charset: 'vni', fallbackSlot: 'vni' },
	{ pattern: /(^|[_.\-\s])(tcvn|abc)([_.\-\s]|$)|vntime|vncentury|timesi|\.vn/i, charset: 'tcvn3', fallbackSlot: 'tcvn3' }
]

const LEGACY_STYLE_ALIASES = {
	vni: ['VN_VNI', 'VN_VNI.SHX', 'vn_vni', 'vni-times', 'vni-helve', 'vnarial', '.vnarial', 'vntimeh'],
	tcvn3: ['TCVN3', 'TCVN3TXT', 'TCVN3txt', 'TCVN3txt.shx', 'vntime', 'VNTIME__', '.vntime', 'timesi', 'vncentury-schoolbook']
} as const

const ESSENTIAL_FONT_NAMES = [
	'Noto Sans',
	'NotoSans-Regular',
	'Noto Serif',
	'NotoSerif-Regular',
	'VN_VNI',
	'TCVN3txt',
	'Arimo',
	'Tinos',
	'romans',
	'simplex',
	'txt'
]

const props = withDefaults(
	defineProps<{
		url?: string
		localFile?: File
		locale?: 'en' | 'zh'
		baseUrl?: string
		useMainThreadDraw?: boolean
		largeFileSettings?: LargeFileSettings
	}>(),
	{
		url: undefined,
		localFile: undefined,
		locale: 'en',
		baseUrl: `${import.meta.env.BASE_URL}assets/`,
		useMainThreadDraw: false,
		largeFileSettings: undefined
	}
)
const emit = defineEmits<{
	create: []
}>()

const VIETNAMESE_NORMALIZE_CHUNK_SIZE = 500
const VIETNAMESE_NORMALIZE_LARGE_CHUNK_SIZE = 2000

const normalizedLegacyDatabases = new WeakSet<AcDbDatabase>()

let fontDiagnosticsBound = false
let preloadFontNamesPromise: Promise<string[]> | null = null
let vietnameseFontFallbackConfiguredPromise: Promise<void> | null = null
/** Updated from large-file settings; prototype patch closes over this module flag. */
let deferVietnameseNormalize = false
let vietnameseNormalizeChunkSize = VIETNAMESE_NORMALIZE_CHUNK_SIZE

const resolvedBaseUrl = props.baseUrl
const useMainThreadDraw = props.useMainThreadDraw
/** Prefer local File open via arrayBuffer; only fall back to URL for remote sources. */
const viewerUrl = computed(() => (props.localFile ? undefined : props.url))
const largeFileSettings = computed(
	() =>
		props.largeFileSettings ?? {
			isLargeFile: false,
			useMainThreadDraw: false,
			enableOsmOverlay: true,
			minimumChunkSize: 1000,
			renderChunkSize: Number.POSITIVE_INFINITY,
			parserTimeoutMs: undefined,
			preloadAllFonts: true,
			deferPostLoadWork: false
		}
)

const getAutoFallbackFontCandidates = () => {
	const configuredFallbacks = Object.values(AcApSettingManager.instance.fontMapping)
		.filter((fontName): fontName is string => typeof fontName === 'string')
		.map((fontName) => fontName.trim())
		.filter((fontName) => fontName.length > 0)

	return Array.from(new Set(configuredFallbacks))
}

const pickAvailableFontName = (availableFontNames: string[], candidates: string[]) => {
	if (availableFontNames.length === 0) {
		return candidates[0]
	}

	const canonicalByLowerName = new Map(
		availableFontNames.map((fontName) => [fontName.toLowerCase(), fontName])
	)

	for (const candidate of candidates) {
		const found = canonicalByLowerName.get(candidate.toLowerCase())
		if (found) {
			return found
		}
	}

	return availableFontNames[0]
}

const getLegacyStyleRule = (styleName: string) => {
	const normalizedStyleName = styleName.trim()
	if (!normalizedStyleName) {
		return null
	}

	for (const rule of HARD_STYLE_NAME_RULES) {
		if (rule.pattern.test(normalizedStyleName)) {
			return rule
		}
	}

	return null
}

const configureVietnameseFontFallback = (
	fallbackFonts: {
		defaultFont: string
		tcvn3Font: string
		vniFont: string
	} = {
		defaultFont: 'BeVietnamPro-Regular',
		tcvn3Font: 'Noto Serif',
		vniFont: 'BeVietnamPro-Regular'
	}
) => {
	const settingManager = AcApSettingManager.instance
	const mapping = {
		...settingManager.fontMapping
	}

	const addAlias = (alias: string, fallbackFont: string, overwrite = false) => {
		const variants = new Set([alias, alias.toLowerCase(), alias.toUpperCase()])

		for (const variant of variants) {
			if (overwrite || !mapping[variant]) {
				mapping[variant] = fallbackFont
			}
		}
	}

	const aliases = [
		'arial',
		'arial.ttf',
		'arialnarrow',
		'arialnarrow.ttf',
		'arial unicode ms',
		'times new roman',
		'times.ttf',
		'timesnewromanpsmt',
		'tahoma',
		'tahoma.ttf',
		'verdana',
		'verdana.ttf',
		'calibri',
		'calibri.ttf',
		'segoe ui',
		'segoeui.ttf',
		'romans',
		'romans.shx',
		'simplex',
		'simplex.shx',
		'txt',
		'txt.shx',
		'vni-times',
		'vni-helve',
		'vnhelve',
		'vnarial',
		'vntimeh',
		'.vnarial',
		'.vntime',
		'vntime',
		'svn-times new roman',
		'svn-arial',
		'tcvn3'
	]

	for (const alias of aliases) {
		addAlias(alias, fallbackFonts.defaultFont)
	}

	addAlias('txt', fallbackFonts.defaultFont, true)
	addAlias('txt.shx', fallbackFonts.defaultFont, true)

	for (const alias of LEGACY_STYLE_ALIASES.tcvn3) {
		addAlias(alias, fallbackFonts.tcvn3Font)
	}

	for (const alias of LEGACY_STYLE_ALIASES.vni) {
		addAlias(alias, fallbackFonts.vniFont)
	}

	addAlias('vncentury-schoolbook', fallbackFonts.tcvn3Font)
	addAlias('vncentury-schoolbook.ttf', fallbackFonts.tcvn3Font)
	addAlias('vn_vni', fallbackFonts.vniFont)
	addAlias('vn_vni.shx', fallbackFonts.vniFont)
	addAlias('vn_vni.ttf', fallbackFonts.vniFont)
	addAlias('timesi', fallbackFonts.tcvn3Font)
	addAlias('timesi.ttf', fallbackFonts.tcvn3Font)

	settingManager.fontMapping = mapping
}

const getPreloadFontNamesFromManifest = async () => {
	if (preloadFontNamesPromise) {
		return preloadFontNamesPromise
	}

	const manifestUrl = `${resolvedBaseUrl}fonts/fonts.json`
	preloadFontNamesPromise = fetch(manifestUrl)
		.then(async (response) => {
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`)
			}

			const entries = (await response.json()) as FontManifestEntry[]
			const names = Array.from(
				new Set(
					entries.flatMap((entry) => {
						if (!Array.isArray(entry.name)) {
							return []
						}

						return entry.name
							.map((fontName) => fontName.trim())
							.filter((fontName) => fontName.length > 0)
					})
				)
			)

			if (names.length === 0) {
				throw new Error('fonts.json does not contain any font names')
			}

			return names
		})
		.catch((error) => {
			console.warn('[cad-font] failed to parse local fonts.json, fallback to auto detected list', {
				manifestUrl,
				error
			})
			return getAutoFallbackFontCandidates()
		})

	return preloadFontNamesPromise
}

const configureVietnameseFontFallbackFromManifest = async () => {
	if (vietnameseFontFallbackConfiguredPromise) {
		return vietnameseFontFallbackConfiguredPromise
	}

	vietnameseFontFallbackConfiguredPromise = getPreloadFontNamesFromManifest()
		.then((availableFontNames) => {
			const defaultFont = pickAvailableFontName(availableFontNames, [
				'BeVietnamPro-Regular',
				'BeVietnamPro',
				'Noto Sans',
				'NotoSans-Regular',
				'Fira Sans',
				'FiraSans-Regular',
				'Lato',
				'Lato-Regular',
				'Roboto',
				'Roboto-Regular',
				'Open Sans',
				'OpenSans-Regular',
				'Montserrat',
				'Montserrat-Regular',
				'Nunito Sans',
				'NunitoSans-Regular',
				'BeVietnamPro-Regular',
				'BeVietnamPro',
				'SourceSans3-Regular',
				'Source Sans 3',
				'IBMPlexSans-Regular',
				'IBM Plex Sans',
				'Noto Sans',
				'Arimo',
				'TCVN3txt',
				'VN_VNI'
			])
			const tcvn3Font = pickAvailableFontName(availableFontNames, [
				'Noto Serif',
				'NotoSerif-Regular',
				'Lora',
				'Lora-Regular',
				'Roboto Slab',
				'RobotoSlab-Regular',
				'Roboto Slab',
				'RobotoSlab-Regular',
				'NotoSerif-Regular',
				'Noto Serif',
				'SourceSerif4-Regular',
				'Source Serif 4',
				'IBMPlexSerif-Regular',
				'IBM Plex Serif',
				'Tinos',
				'TCVN3txt',
				'vntime'
			])
			const vniFont = pickAvailableFontName(availableFontNames, [
				'BeVietnamPro-Regular',
				'BeVietnamPro',
				'Noto Sans',
				'NotoSans-Regular',
				'Fira Sans',
				'FiraSans-Regular',
				'Lato',
				'Lato-Regular',
				'Roboto',
				'Roboto-Regular',
				'Open Sans',
				'OpenSans-Regular',
				'BeVietnamPro-Regular',
				'BeVietnamPro',
				'SourceSans3-Regular',
				'IBMPlexSans-Regular',
				'Arimo',
				'VN_VNI',
				'vni-times'
			])

			configureVietnameseFontFallback({
				defaultFont,
				tcvn3Font,
				vniFont
			})
		})
		.catch(() => {
			configureVietnameseFontFallback()
		})

	return vietnameseFontFallbackConfiguredPromise
}

const getFontNamesToPreload = async () => {
	const availableFontNames = await getPreloadFontNamesFromManifest()

	if (largeFileSettings.value.preloadAllFonts) {
		return availableFontNames
	}

	const essentialFonts = ESSENTIAL_FONT_NAMES.map((fontName) =>
		pickAvailableFontName(availableFontNames, [fontName])
	)

	return Array.from(new Set(essentialFonts))
}

const preloadVietnameseFallbackFonts = async () => {
	try {
		const preloadFonts = await getFontNamesToPreload()
		if (preloadFonts.length === 0) {
			return
		}

		await AcApDocManager.instance.loadDefaultFonts(preloadFonts)
	} catch (error) {
		console.error('[cad-font] preload fallback fonts failed', error)
	}
}

const getFallbackFontFor = (fontName: string) => {
	const mapping = AcApSettingManager.instance.fontMapping
	return mapping[fontName] ?? mapping[fontName.toLowerCase()] ?? mapping[fontName.toUpperCase()] ?? null
}

const getLegacyCharsetFromFont = (fontName: string): 'vni' | 'tcvn3' | null => {
	const normalized = fontName.toLowerCase().replace(/\s+/g, '')

	if (normalized.includes('vni')) {
		return 'vni'
	}

	if (
		normalized.includes('tcvn') ||
		normalized.includes('abc') ||
		normalized.includes('vntime') ||
		normalized.includes('.vn')
	) {
		return 'tcvn3'
	}

	return null
}

const getLegacyCharsetFromStyleName = (styleName: string): LegacyCharset | null => {
	return getLegacyStyleRule(styleName)?.charset ?? null
}

const hasOnlyAsciiText = (text: string) => {
	return /^[\x00-\x7F]*$/.test(text)
}

const countMatches = (text: string, pattern: RegExp) => {
	const matches = text.match(pattern)
	return matches ? matches.length : 0
}

const getVietnameseReadabilityScore = (text: string) => {
	const vietnameseLetters = countMatches(text, /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/g)
	const replacementChars = countMatches(text, /�/g)
	const controlChars = countMatches(text, /[\x00-\x08\x0B\x0C\x0E-\x1F]/g)
	const legacyGarbage = countMatches(text, /[¤¦¨©ª«¬®±²³µ¶·¸¹º»¼½¾¿Ð×Þß]/g)

	return vietnameseLetters * 4 - replacementChars * 6 - controlChars * 5 - legacyGarbage * 2
}

const safeConvertLegacy = (text: string, charset: 'vni' | 'tcvn3') => {
	try {
		return toUnicode(text, charset)
	} catch {
		return text
	}
}

const pickBestLegacyCandidate = (text: string, fallbackCharset: 'vni' | 'tcvn3' | null) => {
	const candidates = [
		text,
		safeConvertLegacy(text, 'vni'),
		safeConvertLegacy(text, 'tcvn3')
	]

	if (fallbackCharset) {
		candidates.push(safeConvertLegacy(text, fallbackCharset))
	}

	const uniqueCandidates = Array.from(new Set(candidates))
	let best = text
	let bestScore = getVietnameseReadabilityScore(text)

	for (const candidate of uniqueCandidates) {
		const score = getVietnameseReadabilityScore(candidate)
		if (score > bestScore) {
			best = candidate
			bestScore = score
		}
	}

	return best
}

const toUnicodeIfLegacyVietnamese = (text: string, fallbackCharset: 'vni' | 'tcvn3' | null) => {
	if (!text || hasOnlyAsciiText(text)) {
		return text
	}

	const detected = detectCharset(text)

	if (detected === 'vni' || detected === 'tcvn3') {
		return safeConvertLegacy(text, detected)
	}

	if (fallbackCharset) {
		return pickBestLegacyCandidate(text, fallbackCharset)
	}

	return pickBestLegacyCandidate(text, null)
}

const normalizeEntityStringField = (
	entity: unknown,
	fieldName: 'textString' | 'contents',
	fallbackCharset: 'vni' | 'tcvn3' | null
) => {
	if (!entity || typeof entity !== 'object') {
		return
	}

	const record = entity as Record<string, unknown>
	const rawValue = record[fieldName]
	if (typeof rawValue !== 'string') {
		return
	}

	const converted = toUnicodeIfLegacyVietnamese(rawValue, fallbackCharset)
	if (converted !== rawValue) {
		record[fieldName] = converted
	}
}

const scheduleIdleWork = (callback: () => void, timeoutMs: number) => {
	const idleWindow = window as Window & {
		requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
	}

	if (typeof idleWindow.requestIdleCallback === 'function') {
		idleWindow.requestIdleCallback(callback, { timeout: timeoutMs })
		return
	}

	window.setTimeout(callback, Math.min(timeoutMs, 250))
}

const normalizeLegacyVietnameseText = async (
	database: AcDbDatabase,
	chunkSize = VIETNAMESE_NORMALIZE_CHUNK_SIZE
) => {
	const textStyleTable = database.tables.textStyleTable
	let hasChanges = false

	for (const blockRecord of database.tables.blockTable.newIterator()) {
		const entities = Array.from(blockRecord.newIterator())

		for (let index = 0; index < entities.length; index += chunkSize) {
			const chunk = entities.slice(index, index + chunkSize)

			for (const entity of chunk) {
				const entityRecord = entity as unknown as { styleName?: unknown }
				const entityStyleName =
					typeof entityRecord.styleName === 'string'
						? entityRecord.styleName
						: ''
				const styleRecord = entityStyleName ? textStyleTable.getAt(entityStyleName) : undefined
				const fontHint = `${styleRecord?.fileName ?? ''} ${entityStyleName}`
				const charsetFromStyleName = getLegacyCharsetFromStyleName(entityStyleName)
				const charsetFromFont = getLegacyCharsetFromFont(fontHint)
				const preferredCharset = charsetFromStyleName ?? charsetFromFont

				const beforeText =
					typeof (entity as { textString?: unknown }).textString === 'string'
						? (entity as { textString: string }).textString
						: ''
				const beforeContents =
					typeof (entity as { contents?: unknown }).contents === 'string'
						? (entity as { contents: string }).contents
						: ''

				if (entity instanceof AcDbText || entity instanceof AcDbMText) {
					normalizeEntityStringField(entity, 'textString', preferredCharset)
					normalizeEntityStringField(entity, 'contents', preferredCharset)
				} else {
					normalizeEntityStringField(entity, 'textString', preferredCharset)
					normalizeEntityStringField(entity, 'contents', preferredCharset)
				}

				const afterText =
					typeof (entity as { textString?: unknown }).textString === 'string'
						? (entity as { textString: string }).textString
						: ''
				const afterContents =
					typeof (entity as { contents?: unknown }).contents === 'string'
						? (entity as { contents: string }).contents
						: ''

				if (beforeText !== afterText || beforeContents !== afterContents) {
					hasChanges = true
				}
			}

			if (index + chunkSize < entities.length) {
				await new Promise<void>((resolve) => {
					window.requestAnimationFrame(() => resolve())
				})
			}
		}
	}

	return hasChanges
}

const patchLegacyVietnameseDecoder = (
	prototype: {
		openDocument?: (
			fileName: string,
			content: ArrayBuffer,
			options: unknown
		) => Promise<boolean>
	}
) => {
	const originalOpenDocument = prototype.openDocument

	if (!originalOpenDocument || originalOpenDocument.name === 'patchedOpenDocument') {
		return
	}

	prototype.openDocument = async function patchedOpenDocument(
		this: AcApDocument,
		fileName: string,
		content: ArrayBuffer,
		options: unknown
	) {
		const success = await originalOpenDocument.call(this, fileName, content, options)

		if (success && !normalizedLegacyDatabases.has(this.database)) {
			normalizedLegacyDatabases.add(this.database)

			const deferMs = deferVietnameseNormalize ? 2_500 : 0
			const normalizeChunkSize = vietnameseNormalizeChunkSize

			scheduleIdleWork(() => {
				void (async () => {
					try {
						const hasChanges = await normalizeLegacyVietnameseText(
							this.database,
							normalizeChunkSize
						)
						if (hasChanges && AcApDocManager.instance.curDocument === this) {
							AcApDocManager.instance.regen()
						}
					} catch (error) {
						console.warn('[cad-font] normalize legacy Vietnamese text failed', error)
					}
				})()
			}, deferMs)
		}

		return success
	}
}

const bindFontDiagnostics = () => {
	if (fontDiagnosticsBound) {
		return
	}

	eventBus.on('font-not-found', ({ fontName, count }) => {
		const fallbackFont = getFallbackFontFor(fontName)

		if (fallbackFont) {
			return
		}

		void count
		void fontName
	})

	eventBus.on('fonts-not-found', ({ fonts }) => {
		const unresolvedFonts = fonts.filter((fontName) => !getFallbackFontFor(fontName))

		if (unresolvedFonts.length === 0) {
			console.info('[cad-font] all missing fonts were covered by fallback mapping', fonts)
			return
		}

		void unresolvedFonts
	})

	eventBus.on('fonts-not-loaded', ({ fonts }) => {
		void fonts
	})

	eventBus.on('failed-to-get-avaiable-fonts', ({ url: failedUrl }) => {
		console.error('[cad-font] failed to fetch fonts metadata', { url: failedUrl })
	})

	fontDiagnosticsBound = true
}

patchLegacyVietnameseDecoder(
	AcApDocument.prototype as unknown as {
		openDocument?: (
			fileName: string,
			content: ArrayBuffer,
			options: unknown
		) => Promise<boolean>
	}
)

watch(
	largeFileSettings,
	(settings) => {
		deferVietnameseNormalize = settings.deferPostLoadWork
		vietnameseNormalizeChunkSize = settings.deferPostLoadWork
			? VIETNAMESE_NORMALIZE_LARGE_CHUNK_SIZE
			: VIETNAMESE_NORMALIZE_CHUNK_SIZE

		applyCadPerformanceSettings({
			minimumChunkSize: settings.minimumChunkSize,
			renderChunkSize: settings.renderChunkSize,
			parserTimeoutMs: settings.parserTimeoutMs,
			isLargeFile: settings.isLargeFile
		})
	},
	{ immediate: true, deep: true }
)

const openLocalFileFast = async (file: File) => {
	const settings = largeFileSettings.value
	const content = await file.arrayBuffer()
	const opened = await AcApDocManager.instance.openDocument(file.name, content, {
		minimumChunkSize: settings.minimumChunkSize,
		mode: AcEdOpenMode.Write,
		...(settings.parserTimeoutMs != null ? { timeout: settings.parserTimeoutMs } : {})
	})

	if (!opened) {
		throw new Error(`Failed to open local file: ${file.name}`)
	}
}

const handleViewerCreate = async () => {
	bindFontDiagnostics()
	applyCadRenderOptimizations()
	await configureVietnameseFontFallbackFromManifest()
	void preloadVietnameseFallbackFonts()

	if (props.localFile) {
		try {
			await openLocalFileFast(props.localFile)
		} catch (error) {
			console.error('[cad-viewer] failed to open local file', error)
		}
	} else if (!largeFileSettings.value.deferPostLoadWork) {
		// Remote URL path: MlCadViewer opens via :url; regen helps apply font mapping.
		AcApDocManager.instance.regen()
	}

	emit('create')
}
</script>
