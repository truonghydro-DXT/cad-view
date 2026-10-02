declare module 'pdf-lib' {
	export const PageSizes: {
		A4: [number, number]
	}

	export interface PngEmbed {
		width: number
		height: number
	}

	export interface PdfPage {
		drawImage: (
			image: PngEmbed,
			options: { x: number; y: number; width: number; height: number }
		) => void
	}

	export interface PdfDocument {
		embedPng: (bytes: Uint8Array) => Promise<PngEmbed>
		addPage: (size?: [number, number]) => PdfPage
		save: () => Promise<Uint8Array>
	}

	export const PDFDocument: {
		create: () => Promise<PdfDocument>
	}
}