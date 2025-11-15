import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createMarkmap } from "../../markmap/createMarkmap.js";
import { MarkmapMcpContext } from "./context.js";
import { ToolRegistry } from "./tool-registry.js";

export class MarkmapToolRegistry extends ToolRegistry {
    public register(): void {
        this.server.registerTool(
            "markdown_to_mindmap",
            {
                title: "Markdown to Mind Map Converter",
                description:
                    "Converts Markdown content to an interactive HTML mind map",
                inputSchema: z.object({
                    markdown: z
                        .string()
                        .describe("Markdown content to convert into a mind map")
                }),
                outputSchema: z.object({
                    html: z
                        .string()
                        .describe("HTML content of the generated mind map"),
                    contentLength: z
                        .number()
                        .describe("Length of the HTML content"),
                    success: z
                        .boolean()
                        .describe("Whether the conversion was successful"),
                    error: z
                        .string()
                        .optional()
                        .describe("Error message if conversion failed")
                })
            },
            async ({ markdown }: { markdown: string }) => {
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
                        structuredContent: {
                            html: result.content,
                            contentLength: result.content.length,
                            success: true
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
                        structuredContent: {
                            error: error.message,
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
