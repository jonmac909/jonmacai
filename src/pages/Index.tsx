import { Link } from "react-router-dom";
import { Wand2, Film, Video, Zap, ArrowRight } from "lucide-react";

const apps = [
  {
    name: "Seedream",
    description: "Advanced Image Editing & Generation",
    icon: Wand2,
    iconColor: "text-blue-600",
    bgColor: "bg-blue-50",
    path: "/seedream",
  },
  {
    name: "Seedance",
    description: "Pro Image-to-Video Animation",
    icon: Film,
    iconColor: "text-purple-600",
    bgColor: "bg-purple-50",
    path: "/seedance",
  },
  {
    name: "Kling",
    description: "Cinematic Video Generation",
    icon: Video,
    iconColor: "text-green-600",
    bgColor: "bg-green-50",
    path: "/kling",
  },
  {
    name: "Wan Animate",
    description: "Video Replacement & Animation",
    icon: Zap,
    iconColor: "text-amber-600",
    bgColor: "bg-amber-50",
    path: "/wan-animate",
  },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Jon Mac AI</h1>
          <p className="text-lg text-gray-600">
            A suite of professional generative AI tools for image and video creation.
          </p>
          <p className="text-gray-500 mt-2">Select a tool below to begin.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {apps.map((app) => {
            const Icon = app.icon;
            return (
              <Link
                key={app.name}
                to={app.path}
                className="group bg-white rounded-xl p-6 shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-lg ${app.bgColor}`}>
                      <Icon className={`w-8 h-8 ${app.iconColor}`} />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900 mb-1">
                        {app.name}
                      </h2>
                      <p className="text-gray-600">{app.description}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-6 h-6 text-gray-300 group-hover:text-gray-600 transition-colors mt-2" />
                </div>
              </Link>
            );
          })}
        </div>

        <footer className="text-center mt-16 text-gray-500 text-sm">
          © {new Date().getFullYear()} Jon Mac AI.
        </footer>
      </div>
    </div>
  );
};

export default Index;
