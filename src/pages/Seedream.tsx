import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, Download, Loader2, RefreshCw,
  Maximize2, Image as ImageIcon, Info,
  Trash2, Plus, Key, X, ArrowLeft
} from 'lucide-react';

interface InputImage {
  id: string;
  url: string;
  base64: string;
  mimeType: string;
  name: string;
}

const Seedream = () => {
  const [apiKey, setApiKey] = useState('');
  const [activeTab, setActiveTab] = useState('Playground');
  const [prompt, setPrompt] = useState('');
  const [inputImages, setInputImages] = useState<InputImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [selectedOutputIndex, setSelectedOutputIndex] = useState(0);
  const [rawResult, setRawResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [maxImages, setMaxImages] = useState(1);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [viewMode, setViewMode] = useState('Preview');
  const [statusText, setStatusText] = useState('');
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [runCost, setRunCost] = useState(0.04);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const estimatedCost = maxImages * 0.04;
    setRunCost(parseFloat(estimatedCost.toFixed(2)));
  }, [maxImages]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading && startTime) {
      interval = setInterval(() => {
        setElapsedTime(((Date.now() - startTime) / 1000).toFixed(2));
      }, 100);
    }
    return () => clearInterval(interval);
  }, [loading, startTime]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please upload a valid image file.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        const newImage: InputImage = {
          id: Date.now().toString(),
          url: URL.createObjectURL(file),
          base64: base64,
          mimeType: file.type,
          name: file.name
        };
        setInputImages(prev => [...prev, newImage]);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (idToRemove: string) => {
    setInputImages(prev => prev.filter(img => img.id !== idToRemove));
  };

  const handleReset = () => {
    setPrompt('');
    setInputImages([]);
    setGeneratedImages([]);
    setSelectedOutputIndex(0);
    setRawResult(null);
    setElapsedTime(null);
    setError(null);
    setStatusText('');
  };

  const handleDownload = () => {
    const currentImage = generatedImages[selectedOutputIndex];
    if (currentImage) {
      const link = document.createElement('a');
      link.href = currentImage;
      link.download = `seedream-result-${selectedOutputIndex + 1}-${Date.now()}.png`;
      if (currentImage.startsWith('http')) {
        link.target = "_blank";
      }
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const pollWaveSpeedResult = async (requestId: string, key: string): Promise<string[]> => {
    const pollUrl = `https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`;
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < 90; i++) {
      await delay(2000);
      try {
        const response = await fetch(pollUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${key}` }
        });
        if (!response.ok) continue;
        const data = await response.json();
        setRawResult(data);
        const status = data.data?.status;
        setStatusText(status === 'created' ? 'processing' : status);

        if (status === 'completed' || status === 'succeeded') {
          const outputs = data.data?.outputs;
          if (outputs && outputs.length > 0) {
            return outputs.map((o: any) => o.url || o);
          } else {
            if (i === 89) throw new Error('Completed but no output found.');
            continue;
          }
        } else if (status === 'failed') {
          const failReason = data.data?.fail_reason || data.message || 'Unknown server error';
          throw new Error(`Task failed: ${failReason}`);
        }
      } catch (err: any) {
        if (err.message.startsWith('Task failed')) throw err;
        console.error("Polling error (retrying)", err);
      }
    }
    throw new Error('Timed out waiting for image generation.');
  };

  const handleGenerate = async () => {
    if (!apiKey) {
      setError('Please provide a WaveSpeed API Key in the API tab to run this model.');
      setActiveTab('API');
      return;
    }
    if (!prompt) return setError('Please enter a prompt.');
    if (inputImages.length === 0) return setError('Please upload at least one image.');

    setLoading(true);
    setError(null);
    setGeneratedImages([]);
    setRawResult(null);
    setStartTime(Date.now());
    setStatusText('processing');

    try {
      const submitUrl = 'https://api.wavespeed.ai/api/v3/bytedance/seedream-v4.5/edit';
      const imagePayload = inputImages.map(img => `data:${img.mimeType};base64,${img.base64}`);
      const requests: Promise<any>[] = [];

      for (let i = 0; i < maxImages; i++) {
        const seed = Math.floor(Math.random() * 2147483647);
        const payload = {
          prompt: prompt,
          images: imagePayload,
          size: `${width}*${height}`,
          enable_sync_mode: false,
          enable_base64_output: false,
          seed: seed
        };

        const req = fetch(submitUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        }).then(async (res) => {
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Request ${i + 1} Failed: ${text}`);
          }
          return res.json();
        });
        requests.push(req);
      }

      const submitResults = await Promise.all(requests);
      const requestIds = submitResults.map(r => r.data?.id).filter(id => id);
      if (requestIds.length === 0) throw new Error("No valid Request IDs returned.");

      const pollingPromises = requestIds.map(id => pollWaveSpeedResult(id, apiKey));
      const resultsArrays = await Promise.all(pollingPromises);
      const allFinalImages = resultsArrays.flat();

      const processedImages: string[] = allFinalImages.map((img: any) => {
        if (typeof img === 'string') {
          if (img.startsWith('http')) return img;
          if (img.startsWith('data:')) return img;
          return `data:image/png;base64,${img}`;
        }
        return img?.url || img;
      });

      setGeneratedImages(processedImages);
      setSelectedOutputIndex(0);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
      setStatusText('failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      {isFullscreen && generatedImages.length > 0 && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={generatedImages[selectedOutputIndex]}
            alt="Fullscreen result"
            className="max-w-full max-h-full object-contain"
          />
          {generatedImages.length > 1 && (
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
              {generatedImages.map((img, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedOutputIndex(idx)}
                  className={`w-12 h-12 rounded overflow-hidden cursor-pointer border-2 ${selectedOutputIndex === idx ? 'border-white' : 'border-transparent'}`}
                >
                  <img src={img} alt={`Thumbnail ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">Jon Mac AI - Seedream</h1>
          </div>
          <div className="flex gap-2 bg-gray-200 p-1 rounded-lg">
            {['Playground', 'API'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab
                  ? 'bg-blue-50 text-blue-600 shadow-sm border border-blue-100'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'API' ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Key className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-semibold">API Configuration</h2>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-2">WaveSpeed API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full p-3 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <p className="text-xs text-gray-500 mt-2">
              Enter your WaveSpeed API key here to use the bytedance/seedream-v4.5/edit model. Key is required.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Panel - Controls */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  prompt <span className="text-red-500">*</span>
                  <Info className="w-3.5 h-3.5 text-gray-400" />
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe what you want to generate..."
                  className="w-full p-3 border border-gray-300 rounded-lg text-sm min-h-[100px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  images <span className="text-red-500">*</span>
                  <Info className="w-3.5 h-3.5 text-gray-400" />
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {inputImages.map((img) => (
                  <div key={img.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg mb-2">
                    <span className="text-sm text-gray-600 truncate flex-1">{img.name}</span>
                    <Trash2
                      className="w-4 h-4 text-gray-400 hover:text-red-500 cursor-pointer ml-2"
                      onClick={() => removeImage(img.id)}
                    />
                  </div>
                ))}
                {inputImages.length === 0 && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors"
                  >
                    <ImageIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Click to upload or drag & drop</p>
                  </div>
                )}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2 mt-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center gap-2 text-sm font-medium shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add Image
                </button>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">size</label>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12">width</span>
                    <input
                      type="range"
                      min="512"
                      max="4096"
                      step="64"
                      value={width}
                      onChange={(e) => setWidth(parseInt(e.target.value))}
                      className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <input
                      type="number"
                      value={width}
                      onChange={(e) => setWidth(parseInt(e.target.value))}
                      className="w-16 p-1.5 text-center border border-gray-300 rounded text-sm bg-white"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-12">height</span>
                    <input
                      type="range"
                      min="512"
                      max="4096"
                      step="64"
                      value={height}
                      onChange={(e) => setHeight(parseInt(e.target.value))}
                      className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <input
                      type="number"
                      value={height}
                      onChange={(e) => setHeight(parseInt(e.target.value))}
                      className="w-16 p-1.5 text-center border border-gray-300 rounded text-sm bg-white"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  max_images
                  <Info className="w-3.5 h-3.5 text-gray-400" />
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="4"
                    value={maxImages}
                    onChange={(e) => setMaxImages(parseInt(e.target.value))}
                    className="flex-1 h-1.5 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span className="text-sm font-medium text-gray-700 w-8 text-center">{maxImages}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleReset}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Reset
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Run'}
                  <span className="text-xs opacity-75">${runCost}</span>
                </button>
              </div>
            </div>

            {/* Right Panel - Output */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {statusText && (
                    <span className="flex items-center gap-2 text-sm text-gray-600">
                      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                      {statusText === 'created' ? 'processing' : statusText}
                      {elapsedTime && ` ${elapsedTime}s taken`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDownload}
                    disabled={generatedImages.length === 0}
                    className={`p-2 text-gray-500 rounded-md transition-colors ${generatedImages.length > 0 ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'}`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => generatedImages.length > 0 && setIsFullscreen(true)}
                    disabled={generatedImages.length === 0}
                    className={`p-2 text-gray-500 rounded-md transition-colors ${generatedImages.length > 0 ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'}`}
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                  <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                      onClick={() => setViewMode('Preview')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md ${viewMode === 'Preview' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => setViewMode('JSON')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md ${viewMode === 'JSON' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      JSON
                    </button>
                  </div>
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg min-h-[400px] flex items-center justify-center bg-gray-50">
                {viewMode === 'Preview' ? (
                  generatedImages.length > 0 ? (
                    <div className="w-full h-full">
                      <img
                        src={generatedImages[selectedOutputIndex]}
                        alt="Generated result"
                        className="max-w-full max-h-[400px] object-contain mx-auto"
                      />
                      {generatedImages.length > 1 && (
                        <div className="flex justify-center gap-2 mt-4">
                          {generatedImages.map((img, idx) => (
                            <button
                              key={idx}
                              onClick={() => setSelectedOutputIndex(idx)}
                              className={`w-16 h-16 rounded border-2 overflow-hidden cursor-pointer shadow-sm transition-colors ${selectedOutputIndex === idx ? 'border-blue-600' : 'border-gray-200 hover:border-blue-300'}`}
                            >
                              <img src={img} alt={`Thumbnail ${idx + 1}`} className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : error ? (
                    <p className="text-red-500 text-sm">{error}</p>
                  ) : (
                    <div className="text-center text-gray-400">
                      <ImageIcon className="w-12 h-12 mb-2 mx-auto opacity-20" />
                      <p>Generated image will appear here</p>
                    </div>
                  )
                ) : (
                  <pre className="w-full h-full p-4 text-xs text-gray-600 overflow-auto">
                    {rawResult ? JSON.stringify(rawResult, null, 2) : '// No JSON data available yet'}
                  </pre>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
                <Info className="w-3 h-3 text-blue-600" />
                <span>Your request will cost ${runCost} per run.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Seedream;
