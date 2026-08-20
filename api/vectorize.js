export default async function handler(req, res) {
  // Разрешаем только POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    // ChatGPT передаёт загруженный файл через openaiFileIdRefs.
    // Нам нужна временная ссылка на этот файл.
    let imageUrl = null;

    if (Array.isArray(body.openaiFileIdRefs) && body.openaiFileIdRefs.length > 0) {
      const file = body.openaiFileIdRefs[0];

      imageUrl =
        file.download_link ||
        file.downloadLink ||
        file.url ||
        null;
    }

    // Для тестирования также разрешаем обычный image_url.
    if (!imageUrl && typeof body.image_url === "string") {
      imageUrl = body.image_url;
    }

    if (!imageUrl) {
      return res.status(400).json({
        error: "Не найдено изображение",
        details: "ChatGPT должен передать openaiFileIdRefs с download_link."
      });
    }

    const apiKey = process.env.GENAPI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Не настроен GENAPI_API_KEY в Vercel."
      });
    }

    // Отправляем изображение в GenAPI Image2SVG.
    const response = await fetch(
      "https://api.gen-api.ru/api/v1/networks/image-2-svg",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          is_sync: true,
          image_url: imageUrl,

          colormode: "color",
          hierarchical: "stacked",
          mode: "spline",

          filter_speckle: 4,
          color_precision: 6,
          layer_difference: 16,
          corner_threshold: 60,
          length_threshold: 4,
          max_iterations: 10,
          splice_threshold: 45,
          path_precision: 3
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Ошибка GenAPI",
        details: data
      });
    }

    // Если GenAPI сразу вернул результат.
    if (data.result && Array.isArray(data.result)) {
      return res.status(200).json({
        success: true,
        message: "Изображение успешно векторизовано.",
        svg_url: data.result[0],
        result: data.result
      });
    }

    // Если API вернул request_id.
    if (data.request_id) {
      return res.status(200).json({
        success: true,
        message: "Векторизация запущена.",
        request_id: data.request_id,
        status: data.status || "processing"
      });
    }

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    return res.status(500).json({
      error: "Ошибка сервера",
      details: error.message
    });
  }
}
