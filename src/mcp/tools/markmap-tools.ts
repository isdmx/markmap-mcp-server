import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "path";
import { z } from "zod";
import { createMarkmap } from "../../markmap/createMarkmap.js";
import { MarkmapMcpContext } from "./context.js";
import { ToolRegistry } from "./tool-registry.js";

export class MarkmapToolRegistry extends ToolRegistry {
    public register(): void {
        this.server.tool(
            "markdown_to_mindmap",
            "Convert a Markdown document into an interactive mind map",
            {
                markdown: z
                    .string()
                    .describe("Markdown content to convert into a mind map"),
                open: z
                    .boolean()
                    .default(false)
                    .describe(
                        "Whether to open the generated mind map in a browser (default: false)"
                    )
            },
            {
                title: "Markdown to Mind Map Converter",
                description: "Converts Markdown content to an interactive HTML mind map with export capabilities",
                outputDescription: "Returns structured content with HTML mind map and metadata. The response includes the HTML content of the mind map and metadata about the generated content.",
                outputSchema: {
                    type: "object",
                    properties: {
                        content: {
                            type: "array",
                            description: "Array of content items in the response",
                            items: {
                                type: "object",
                                oneOf: [
                                    {
                                        type: "object",
                                        properties: {
                                            type: "string",
                                            const: "text"
                                        },
                                        required: ["type", "text"]
                                    }
                                ],
                                description: "Content item with type and text"
                            }
                        },
                        _meta: {
                            type: "object",
                            description: "Metadata about the generated content",
                            properties: {
                                mimeType: {
                                    type: "string",
                                    description: "MIME type of the generated content",
                                    example: "text/html"
                                },
                                contentLength: {
                                    type: "number",
                                    description: "Length of the HTML content"
                                },
                                hasHtmlContent: {
                                    type: "boolean",
                                    description: "Indicates that HTML content is present in the response"
                                }
                            },
                            required: ["mimeType", "contentLength", "hasHtmlContent"]
                        }
                    },
                    required: ["content", "_meta"],
                    description: "Structured response containing the generated mind map HTML content and metadata"
                }
            },
            async ({ markdown, open }: { markdown: string; open: boolean }) => {
                try {
                    // Don't save to file, just generate the HTML content
                    const result = await createMarkmap({
                        content: markdown,
                        openIt: false // Don't open in browser since we're returning content directly
                    });

                    return {
                        content: [
                            {
                                type: "text",
                                text: result.content // Text content for compatibility
                            }
                        ],
                        structuredContent: { // Associative array/object containing the HTML data
                            html: result.content,
                            mimeType: "text/html",
                            contentLength: result.content.length
                        },
                        _meta: {
                            mimeType: "text/html",
                            contentLength: result.content.length,
                            hasHtmlContent: true
                        }
                    };
                } catch (error: any) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Error: ${error.message}`
                            }
                        ],
                        structuredContent: { // Associative array/object for error case
                            error: error.message,
                            success: false
                        },
                        _meta: {
                            error: "Failed to generate markmap",
                            message: error.message,
                            success: false
                        }
                    };
                }
            }
        );
    }
}

/**
 * Registers Markmap tools with the provided server and context.
 * @param server - The MCP server instance to register tools with
 * @param context - The context object containing configuration and state information
 */
export function registerMarkmapTools(
    server: McpServer,
    context: MarkmapMcpContext
): void {
    const registry = new MarkmapToolRegistry(server, context);
    registry.register();
}
