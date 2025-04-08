import * as renderer from '../renderer';
import * as shaders from '../shaders/shaders';
import { Stage } from '../stage/stage';

export class ClusteredOptimizedDeferredRenderer extends renderer.Renderer {
    // TODO-3: add layouts, pipelines, textures, etc. needed for Forward+ here
    // you may need extra uniforms such as the camera view matrix and the canvas resolution
    sceneUniformsBindGroupLayout: GPUBindGroupLayout;
    sceneUniformsBindGroup: GPUBindGroup;

    depthTexture: GPUTexture;
    depthTextureView: GPUTextureView;
    
    // G-buffer textures and related views
    gBufferTextures: {
        pack: GPUTexture;
    };
    gBufferTextureViews: {
        pack: GPUTextureView;
    };

    gBufferBindGroupLayout: GPUBindGroupLayout;
    gBufferBindGroup: GPUBindGroup;
    gBufferPipeline: GPURenderPipeline;
    fullscreenPipeline: GPURenderPipeline;

    // Post Processing
    renderTexture: GPUTexture;
    renderTextureView: GPUTextureView;

    // Compute Pass
    computeBindGroupLayout: GPUBindGroupLayout;
    computeBindGroup: GPUBindGroup;
    computePipeline: GPUComputePipeline;

    constructor(stage: Stage) {
        super(stage);
        // TODO-3: initialize layouts, pipelines, textures, etc. needed for Forward+ here
        // you'll need two pipelines: one for the G-buffer pass and one for the fullscreen pass
        this.sceneUniformsBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "scene uniforms bind group layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                { // lightSet
                    binding: 1,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                },
                { // clusterSet
                    binding: 2,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
                }
            ]
        });

        this.sceneUniformsBindGroup = renderer.device.createBindGroup({
            label: "scene uniforms bind group",
            layout: this.sceneUniformsBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.camera.uniformsBuffer }
                },
                {
                    binding: 1,
                    resource: { buffer: this.lights.lightSetStorageBuffer }
                },
                {
                    binding: 2,
                    resource: { buffer: this.lights.clusterSetStorageBuffer }
                }
            ]
        });

        this.depthTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.depthTextureView = this.depthTexture.createView();

        // Create G-buffer textures
        const textureSize = {
            width: renderer.canvas.width,
            height: renderer.canvas.height
        };
        
        this.gBufferTextures = {
            pack: renderer.device.createTexture({
                label: "pack G-buffer",
                size: textureSize,
                format: "rgba32uint",
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            })
        };
        this.gBufferTextureViews = {
            pack: this.gBufferTextures.pack.createView()
        };
        
        this.gBufferBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "G-buffer bind group layout",
            entries: [
                { // pack
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
                    texture: { sampleType: "uint" }
                }
            ]
        });
        
        this.gBufferBindGroup = renderer.device.createBindGroup({
            label: "G-buffer bind group",
            layout: this.gBufferBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.gBufferTextureViews.pack
                }
            ]
        });
        
        this.gBufferPipeline = renderer.device.createRenderPipeline({
            label: "G-buffer render pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "G-buffer pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    renderer.modelBindGroupLayout,
                    renderer.materialBindGroupLayout
                ]
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "naive vertex shader",
                    code: shaders.naiveVertSrc  // Reuse naive vertex shader
                }),
                buffers: [renderer.vertexBufferLayout]
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "G-buffer fragment shader",
                    code: shaders.clusteredOptimizedDeferredFragSrc
                }),
                targets: [
                    { format: "rgba32uint" }
                ]
            },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less"
            },
            primitive: {
                cullMode: "back"
            }
        });
        
        this.fullscreenPipeline = renderer.device.createRenderPipeline({
            label: "fullscreen render pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "fullscreen pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    this.gBufferBindGroupLayout
                ]
            }),
            vertex: {
                module: renderer.device.createShaderModule({
                    label: "fullscreen vertex shader",
                    code: shaders.clusteredOptimizedDeferredFullscreenVertSrc
                }),
                entryPoint: "main"
            },
            fragment: {
                module: renderer.device.createShaderModule({
                    label: "fullscreen fragment shader",
                    code: shaders.clusteredOptimizedDeferredFullscreenFragSrc
                }),
                targets: [
                    { format: renderer.canvasFormat }
                ]
            }
        });
        
        // Post Processing
        this.renderTexture = renderer.device.createTexture({
            size: [renderer.canvas.width, renderer.canvas.height],
            format: "rgba8unorm",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
        });
        this.renderTextureView = this.renderTexture.createView();

        // Compute Pass
        this.computeBindGroupLayout = renderer.device.createBindGroupLayout({
            label: "compute bind group layout",
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: {
                        access: "write-only",
                        format: "rgba8unorm",
                        viewDimension: "2d"
                    }
                }
            ]
        });

        this.computeBindGroup = renderer.device.createBindGroup({
            label: "compute bind group",
            layout: this.computeBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: this.renderTextureView
                }
            ]
        });

        this.computePipeline = renderer.device.createComputePipeline({
            label: "compute pipeline",
            layout: renderer.device.createPipelineLayout({
                label: "compute pipeline layout",
                bindGroupLayouts: [
                    this.sceneUniformsBindGroupLayout,
                    this.gBufferBindGroupLayout,
                    this.computeBindGroupLayout
                ]
            }),
            compute: {
                module: renderer.device.createShaderModule({
                    label: "compute shader",
                    code: shaders.clusteredOptimizedDeferredComputeSrc
                }),
                entryPoint: "main"
            }
        });
    }

    encodeFullscreenPass(encoder: GPUCommandEncoder)
    {
        const canvasTextureView = renderer.context.getCurrentTexture().createView();
        const fullscreenPass = encoder.beginRenderPass({
            label: "fullscreen lighting calculation",
            colorAttachments: [
                {
                    view: canvasTextureView,
                    clearValue: [0, 0, 0, 1],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ]
        });
        
        fullscreenPass.setPipeline(this.fullscreenPipeline);
        fullscreenPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
        fullscreenPass.setBindGroup(shaders.constants.bindGroup_gbuffer, this.gBufferBindGroup);
        fullscreenPass.draw(4);  // Draw fullscreen quad (composed of two triangles in vertex shader)
        
        fullscreenPass.end();
    }

    encodeComputePass(encoder: GPUCommandEncoder)
    {
        // const canvasTextureView = renderer.context.getCurrentTexture().createView();
        const computePass = encoder.beginComputePass();

        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
        computePass.setBindGroup(shaders.constants.bindGroup_gbuffer, this.gBufferBindGroup);
        computePass.setBindGroup(shaders.constants.bindGroup_compute, this.computeBindGroup);
        
        const workgroupSizeX = 8;
        const workgroupSizeY = 8;
        const workgroupCountX = Math.ceil(renderer.canvas.width / workgroupSizeX);
        const workgroupCountY = Math.ceil(renderer.canvas.height / workgroupSizeY);
        
        computePass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
        computePass.end();

        const canvasTexture = renderer.context.getCurrentTexture();
        encoder.copyTextureToTexture(
            { texture: this.renderTexture },
            { texture: canvasTexture },
            [renderer.canvas.width, renderer.canvas.height]
        );
    }

    override draw() {
        const encoder = renderer.device.createCommandEncoder();
        
        // 1st Pass
        this.lights.doLightClustering(encoder);
        
        // 2nd Pass
        const gBufferPass = encoder.beginRenderPass({
            label: "G-buffer rendering",
            colorAttachments: [
                {
                    view: this.gBufferTextureViews.pack,
                    clearValue: [0, 0, 0, 1],
                    loadOp: "clear",
                    storeOp: "store"
                }
            ],
            depthStencilAttachment: {
                view: this.depthTextureView,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store"
            }
        });
        
        gBufferPass.setPipeline(this.gBufferPipeline);
        gBufferPass.setBindGroup(shaders.constants.bindGroup_scene, this.sceneUniformsBindGroup);
        
        this.scene.iterate(node => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_model, node.modelBindGroup);
        }, material => {
            gBufferPass.setBindGroup(shaders.constants.bindGroup_material, material.materialBindGroup);
        }, primitive => {
            gBufferPass.setVertexBuffer(0, primitive.vertexBuffer);
            gBufferPass.setIndexBuffer(primitive.indexBuffer, 'uint32');
            gBufferPass.drawIndexed(primitive.numIndices);
        });
        
        gBufferPass.end();
        
        // 3rd Pass
        this.encodeFullscreenPass(encoder);
        // this.encodeComputePass(encoder);

        // Submit commands
        renderer.device.queue.submit([encoder.finish()]);
    }
}
