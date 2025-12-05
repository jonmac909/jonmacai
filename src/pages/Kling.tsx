import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Download, Loader2, RefreshCw,
  Maximize2, Image as ImageIcon, Info,
  Trash2, Key, X, ArrowLeft
} from 'lucide-react';

interface InputImage {
  id: string;
  url: string;
  base64: string;
  mimeType: string;
  name: string;
}

const Kling = () => {
  const [apiKey, setApiKey] = useState('');
  const [activeTab, setActiveTab] = useState('Playground');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [inputImage, setInputImage] = useState<InputImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [rawResult, setRawResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(5);
  const [guidanceScale, setGuidanceScale] = useState(0.5);
  const [viewMode, setViewMode] = useState('Preview');
  const [statusText, setStatusText] = useState('');
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [runCost, setRunCost] = useState(0.00);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const estimatedCost = duration * 0.042;
    setRunCost(parseFloat(estimatedCost.toFixed(2)));
  }, [duration]);

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
        setInputImage(newImage);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReset = () => {
    setPrompt('');
    setNegativePrompt('');
    setInputImage(null);
    setGeneratedVideo(null);
    setRawResult(null);
    setElapsedTime(null);
    setError(null);
    setStatusText('');
  };

  const handleDownload = () => {
    if (generatedVideo) {
      const link = document.createElement('a');
      link.href = generatedVideo;
      link.download = `kling-video-${Date.now()}.mp4`;
      if (generatedVideo.startsWith('http')) link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const pollWaveSpeedResult = async (requestId: string, key: string): Promise<string> => {
    const pollUrl = `https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`;
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < 150; i++) {
      await delay(2000);
      try {
        const response = await fetch(pollUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${key}` }
        });
        if (!response.ok) continue;
        const data = await response.json();
        setRawResult(data);

        const apiCost = data.extra?.cost || data.cost;
        if (apiCost !== undefined) setRunCost(apiCost);

        const status = data.data?.status;
        setStatusText(status === 'created' ? 'processing' : status);

        if (status === 'completed' || status === 'succeeded') {
          const outputs = data.data?.outputs;
          if (outputs && outputs.length > 0) {
            return outputs[0]?.url || outputs[0];
          } else {
            if (i === 149) throw new Error('Completed but no output found.');
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
    throw new Error('Timed out waiting for video generation.');
  };

  const handleGenerate = async () => {
    if (!apiKey) {
      setError('Please provide a WaveSpeed API Key in the API tab to run this model.');
      setActiveTab('API');
      return;
    }
    if (!prompt) return setError('Please enter a prompt.');
    if (!inputImage) return setError('Please upload an image.');

    setLoading(true);
    setError(null);
    setGeneratedVideo(null);
    setRawResult(null);
    setStartTime(Date.now());
    setStatusText('processing');

    try {
      const submitUrl = 'https://api.wavespeed.ai/api/v3/kwaivgi/kling-v2.5-turbo-std/image-to-video';
      const payload = {
        image: `data:${inputImage.mimeType};base64,${inputImage.base64}`,
        prompt: prompt,
        negative_prompt: negativePrompt,
        duration: parseInt(String(duration)),
        guidance_scale: parseFloat(String(guidanceScale))
      };

      const response = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Request Failed (${response.status}): ${errText}`);
      }

      const submitResult = await response.json();
      const requestId = submitResult.data?.id;
      if (!requestId) throw new Error("No Request ID returned.");

      const finalVideoUrl = await pollWaveSpeedResult(requestId, apiKey);
      setGeneratedVideo(finalVideoUrl);
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
      {isFullscreen && generatedVideo && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <video src={generatedVideo} controls autoPlay className="max-w-full max-h-full" />
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">Jon Mac AI - Kling</h1>
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
              Enter your WaveSpeed API key here. Uses kling-v2.5-turbo-std/image-to-video. Key is required.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                  image <span className="text-red-500">*</span>
                  <Info className="w-3.5 h-3.5 text-gray-400" />
                </label>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                {inputImage ? (
                  <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600 truncate flex-1">{inputImage.name}</span>
                    <Trash2
                      className="w-4 h-4 text-gray-400 hover:text-red-500 cursor-pointer ml-2"
                      onClick={() => setInputImage(null)}
                    />
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors"
                  >
                    <ImageIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Click to upload or drag & drop</p>
                  </div>
                )}
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  negative_prompt <Info className="w-3.5 h-3.5 text-gray-400" />
                </label>
                <input
                  type="text"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  placeholder="What to avoid..."
                  className="w-full p-2 border border-gray-300 rounded-md text-sm bg-white focus:border-blue-500 outline-none"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  guidance_scale <Info className="w-3.5 h-3.5 text-gray-400" />
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={guidanceScale}
                    onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 bg-blue-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span className="text-sm font-medium text-gray-700 w-10 text-center">{guidanceScale}</span>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                  duration <Info className="w-3.5 h-3.5 text-gray-400" />
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  <option value="5">5</option>
                  <option value="10">10</option>
                </select>
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
                  <span className="text-xs opacity-75">${runCost > 0 ? runCost : '0.00'}</span>
                </button>
              </div>
            </div>

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
                    disabled={!generatedVideo}
                    className={`p-2 text-gray-500 rounded-md transition-colors ${generatedVideo ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'}`}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => generatedVideo && setIsFullscreen(true)}
                    disabled={!generatedVideo}
                    className={`p-2 text-gray-500 rounded-md transition-colors ${generatedVideo ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed'}`}
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
                  generatedVideo ? (
                    <video src={generatedVideo} controls className="max-w-full max-h-[400px]" />
                  ) : error ? (
                    <p className="text-red-500 text-sm">{error}</p>
                  ) : (
                    <div className="text-center text-gray-400">
                      <ImageIcon className="w-12 h-12 mb-2 mx-auto opacity-20" />
                      <p>Generated video will appear here</p>
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
                <span>Your request will cost ${runCost > 0 ? runCost : '0.00'} per run. Video generation typically costs more and takes longer than images.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Kling;
